from __future__ import annotations

import threading

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from .adapters import build_adapter
from .chat_jobs import ChatJobService
from .config import CHAT_JOB_INTERACTIVE_BUDGET_MS_MAX, CHAT_JOB_INTERACTIVE_BUDGET_MS_MIN, LOCAL_CLIENT_HOSTS, Settings
from .gemini import build_broker
from .security import AuthManager
from .store import Store
from .tools import ADAPTER_DIAGNOSTICS_HEADER, ADAPTER_DIAGNOSTICS_RESPONSE_KEY, ToolCallRequest, ToolCancelRequest, ToolService, adapter_diagnostics_headers

class PinRequest(BaseModel):
    pin: str
class TextMessage(BaseModel):
    request_id: str | None = None
    message: str
    mode: str = "quick"
    transcript_window: list[dict] = Field(default_factory=list)
    job: bool = False
    interactive_budget_ms: int | None = Field(default=None, ge=CHAT_JOB_INTERACTIVE_BUDGET_MS_MIN, le=CHAT_JOB_INTERACTIVE_BUDGET_MS_MAX)

LOCAL_HOST_HEADERS = {"127.0.0.1", "localhost", "::1", "testserver"}
CHAT_JOB_HEADER = "X-HVC-Chat-Job"
CHAT_JOB_BUDGET_HEADER = "X-HVC-Chat-Budget-Ms"
CHAT_JOB_ID_HEADER = "X-HVC-Chat-Job-Id"


def host_header_is_local(request: Request) -> bool:
    host = request.headers.get("host", "").strip().lower()
    if not host:
        return False
    if host.startswith("[") and "]" in host:
        hostname = host[1:].split("]", 1)[0]
    else:
        hostname = host.rsplit(":", 1)[0]
    return hostname in LOCAL_HOST_HEADERS


def wants_adapter_diagnostics(request: Request) -> bool:
    return request.headers.get(ADAPTER_DIAGNOSTICS_HEADER, "").strip().lower() in {"1", "true", "yes", "on"}


def wants_chat_job(payload: TextMessage, request: Request) -> bool:
    return payload.job or request.headers.get(CHAT_JOB_HEADER, "").strip().lower() in {"1", "true", "yes", "on"}


def chat_job_budget_ms(payload: TextMessage, request: Request, settings: Settings) -> int:
    if payload.interactive_budget_ms is not None:
        return payload.interactive_budget_ms
    header_value = request.headers.get(CHAT_JOB_BUDGET_HEADER)
    if not header_value:
        return settings.chat_job_interactive_budget_ms
    try:
        parsed = int(header_value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid chat job budget") from exc
    if not CHAT_JOB_INTERACTIVE_BUDGET_MS_MIN <= parsed <= CHAT_JOB_INTERACTIVE_BUDGET_MS_MAX:
        raise HTTPException(status_code=422, detail="Invalid chat job budget")
    return parsed

def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.assert_safe_bind()
    settings.assert_safe_cors()
    settings.assert_safe_auth()
    settings.assert_safe_hermes()
    store = Store(settings.db_path)
    store.prune_audit_logs(settings.audit_log_retention_days, settings.audit_log_max_rows)
    auth = AuthManager(settings.pin, settings.session_ttl_seconds, store, settings.device_ttl_seconds)
    broker = build_broker(settings.gemini_mode)
    adapter = build_adapter(
        settings.hermes_adapter,
        settings.hermes_bin,
        settings.hermes_timeout_seconds,
        settings.agent_name,
        store=store,
        hermes_api_url=settings.hermes_api_url,
        hermes_api_token=settings.hermes_api_token,
        hermes_api_cwd=settings.hermes_api_cwd,
    )
    tools = ToolService(store, adapter)
    chat_jobs = ChatJobService(store, tools)
    app = FastAPI(title="Hermes Voice Control", version="0.1.0")
    app.state.settings = settings
    app.state.store = store
    app.state.tools = tools
    app.state.chat_jobs = chat_jobs
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.frontend_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-Request-ID", ADAPTER_DIAGNOSTICS_HEADER, CHAT_JOB_HEADER, CHAT_JOB_BUDGET_HEADER],
        expose_headers=[ADAPTER_DIAGNOSTICS_HEADER, CHAT_JOB_ID_HEADER, "Location"],
    )
    def warm_hermes_session_async(session_hash: str) -> None:
        # Unlock-time warm: eagerly build/resume the agent session in the
        # background so the first utterance skips the cold-session cost.
        # Resolves the adapter through `tools` so test doubles are honored.
        def _run() -> None:
            try:
                if tools.adapter.warm_session(session_hash):
                    store.log("hermes.warm", "success", session_hash=session_hash)
            except Exception:
                store.log("hermes.warm", "failed", error_code="WARM_ERROR", session_hash=session_hash)
        threading.Thread(target=_run, name="hvc-hermes-warm", daemon=True).start()
    def session_dep(request: Request) -> str:
        if not settings.require_pin:
            client_host = request.client.host if request.client else "local"
            proxy_headers = ("forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "tailscale-user-login", "tailscale-user-name")
            proxied = any(request.headers.get(name) for name in proxy_headers)
            if (client_host not in LOCAL_CLIENT_HOSTS or proxied or not host_header_is_local(request)) and not settings.allow_no_pin_remote:
                raise HTTPException(status_code=401, detail="PIN auth is required for non-local clients")
            return "tailscale-local"
        try:
            return auth.validate(authorization=request.headers.get("authorization"), hvc_session=request.cookies.get("hvc_session"))
        except HTTPException:
            # Remembered device: a valid long-lived device cookie re-mints the
            # short-lived session so the PIN is only ever typed once per device.
            device_token = request.cookies.get("hvc_device")
            if not (settings.remember_device and device_token and auth.validate_device(device_token)):
                raise
            session = auth.create_session()
            # Handlers that return JSONResponse directly bypass the injected
            # response's headers, so the cookie is applied in middleware below.
            request.state.pending_session_cookie = session
            store.log("auth.device", "refreshed", {"session_id": session.token_hash[:12]})
            warm_hermes_session_async(session.token_hash)
            return session.token_hash
    @app.middleware("http")
    async def apply_refreshed_session_cookie(request: Request, call_next):
        result = await call_next(request)
        pending = getattr(request.state, "pending_session_cookie", None)
        if pending is not None:
            AuthManager.set_cookie(result, pending.token, pending.expires_at, secure=settings.secure_cookies)
        return result
    @app.exception_handler(Exception)
    async def safe_exception_handler(request: Request, exc: Exception):
        if isinstance(exc, HTTPException):
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers)
        store.log("error.unhandled", "failed", {"path": request.url.path, "error": str(exc) if settings.debug_errors else "redacted"}, error_code="UNHANDLED")
        return JSONResponse(status_code=500, content={"detail": "Internal server error", "code": "INTERNAL_ERROR"})
    @app.get("/healthz")
    def healthz(): return {"ok": True}
    def readiness() -> tuple[bool, dict]:
        gemini_client_available = broker.client_available
        checks = {
            "database": "unknown",
            "gemini_mode": broker.mode,
            "gemini_model": getattr(broker, "model", None),
            "gemini_voice_name": getattr(broker, "voice_name", None),
            "gemini_api_key_configured": broker.api_key_configured,
            "gemini_client_available": gemini_client_available,
            "hermes_adapter": settings.hermes_adapter,
            "hermes": adapter.diagnostics(),
            "pin_required": settings.require_pin,
            "logs_endpoint_enabled": settings.allow_logs_endpoint,
            "audit_log_retention_days": settings.audit_log_retention_days,
            "audit_log_max_rows": settings.audit_log_max_rows,
        }
        ok = True
        if store.check_writeable():
            checks["database"] = "ok"
        else:
            checks["database"] = "failed"
            ok = False
        if broker.mode == "real" and (not broker.api_key_configured or not gemini_client_available):
            ok = False
        if settings.hermes_adapter in {"local", "api"} and not checks["hermes"].get("available"):
            ok = False
        return ok, checks
    @app.get("/readyz")
    def readyz():
        # Unauthenticated: any tailnet peer can reach this, so expose only the
        # pass/fail bit. Field-level diagnostics live at /readyz/details.
        ok, _ = readiness()
        return JSONResponse(status_code=200 if ok else 503, content={"ok": ok})
    @app.get("/readyz/details")
    def readyz_details(session_hash: str = Depends(session_dep)):
        ok, checks = readiness()
        return JSONResponse(status_code=200 if ok else 503, content={"ok": ok, "checks": checks})
    @app.post("/auth/pin")
    def auth_pin(payload: PinRequest, response: Response, request: Request):
        if not settings.require_pin:
            store.log("auth.pin", "disabled", {"reason": "pin_auth_disabled"})
            raise HTTPException(status_code=404, detail="PIN auth is disabled")
        client_key = request.client.host if request.client else "local"
        if not auth.verify_pin(payload.pin, client_key=client_key):
            store.log("auth.pin", "failed", {"pin_supplied": bool(payload.pin)}, error_code="INVALID_PIN")
            raise HTTPException(status_code=401, detail="Invalid PIN")
        session = auth.create_session()
        auth.set_cookie(response, session.token, session.expires_at, secure=settings.secure_cookies)
        if settings.remember_device:
            device = auth.create_device()
            auth.set_device_cookie(response, device.token, device.expires_at, secure=settings.secure_cookies)
        store.log("auth.pin", "success", {"session_id": session.token})
        warm_hermes_session_async(session.token_hash)
        return {"ok": True, "expires_at": session.expires_at.isoformat()}
    @app.post("/auth/logout")
    def logout(request: Request, response: Response, session_hash: str = Depends(session_dep)):
        token = request.cookies.get("hvc_session")
        if token: auth.revoke(token)
        device_token = request.cookies.get("hvc_device")
        if device_token:
            auth.revoke_device(device_token)
            response.delete_cookie("hvc_device")
        response.delete_cookie("hvc_session")
        store.log("auth.logout", "success", session_hash=session_hash)
        return {"ok": True}
    @app.get("/auth/session")
    def auth_session(session_hash: str = Depends(session_dep)): return {"authenticated": True, "mode": "pin" if settings.require_pin else "tailscale"}
    @app.post("/gemini/ephemeral-token")
    def gemini_token(session_hash: str = Depends(session_dep)):
        token = broker.create_token()
        store.log("gemini.token", "created", {"mode": token.mode, "model": token.model, "voice_name": token.voice_name, "token_issued": True, "expires_at": token.expires_at.isoformat()}, session_hash=session_hash)
        return {"token": token.token, "expires_at": token.expires_at.isoformat(), "mode": token.mode, "model": token.model, "voice_name": token.voice_name}
    @app.get("/gemini/status")
    def gemini_status(session_hash: str = Depends(session_dep)):
        return {"mode": broker.mode, "api_key_configured": broker.api_key_configured}
    @app.get("/tools")
    def list_tools(session_hash: str = Depends(session_dep)): return {"tools": tools.list_tools()}
    @app.post("/tools/call")
    def call_tool(req: ToolCallRequest, session_hash: str = Depends(session_dep)): return tools.call(req, session_hash)
    @app.post("/tools/cancel")
    def cancel_tool(req: ToolCancelRequest, session_hash: str = Depends(session_dep)): return tools.cancel(req, session_hash)
    @app.post("/chat/text")
    def chat_text(payload: TextMessage, request: Request, response: Response, session_hash: str = Depends(session_dep)):
        request_id = (payload.request_id or "").strip() or "text-chat"
        if len(request_id) > 120:
            request_id = "text-chat"
        req = ToolCallRequest(request_id=request_id, tool="ask_agent", arguments={"message": payload.message, "mode": payload.mode, "transcript_window": payload.transcript_window})
        if wants_chat_job(payload, request):
            tools.validate_ask_agent_args(req, session_hash)
            result, status, error = chat_jobs.submit(
                req,
                session_hash,
                budget_ms=chat_job_budget_ms(payload, request, settings),
                include_adapter_diagnostics=wants_adapter_diagnostics(request),
                message_chars=len(payload.message),
                transcript_items=len(payload.transcript_window),
            )
            job_id = status["job_id"]
            if result is None:
                if error is not None:
                    headers = dict(error.headers or {})
                    headers[CHAT_JOB_ID_HEADER] = job_id
                    detail = error.detail if isinstance(error.detail, str) else "Request failed"
                    return JSONResponse(
                        status_code=error.status_code,
                        content={"detail": detail},
                        headers=headers,
                    )
                if status["state"] == "failed":
                    failed_error = status.get("error") or {}
                    return JSONResponse(
                        status_code=failed_error.get("status_code", 500),
                        content={"detail": failed_error.get("detail", "Internal server error")},
                        headers={CHAT_JOB_ID_HEADER: job_id},
                    )
                return JSONResponse(
                    status_code=202,
                    content=status,
                    headers={CHAT_JOB_ID_HEADER: job_id, "Location": f"/chat/jobs/{job_id}"},
                )
            response.headers[CHAT_JOB_ID_HEADER] = job_id
            diagnostics = result.pop(ADAPTER_DIAGNOSTICS_RESPONSE_KEY, None)
            for name, value in adapter_diagnostics_headers(diagnostics).items():
                if name == ADAPTER_DIAGNOSTICS_HEADER:
                    response.headers[name] = value
            return result
        result = tools.call(req, session_hash, include_adapter_diagnostics=wants_adapter_diagnostics(request))
        diagnostics = result.pop(ADAPTER_DIAGNOSTICS_RESPONSE_KEY, None)
        for name, value in adapter_diagnostics_headers(diagnostics).items():
            if name == ADAPTER_DIAGNOSTICS_HEADER:
                response.headers[name] = value
        return result
    @app.get("/chat/jobs/{job_id}")
    def chat_job_status(job_id: str, session_hash: str = Depends(session_dep)):
        status = chat_jobs.status(job_id, session_hash)
        if status is None:
            raise HTTPException(status_code=404, detail="Chat job not found")
        return status
    @app.post("/chat/jobs/{job_id}/cancel")
    def chat_job_cancel(job_id: str, session_hash: str = Depends(session_dep)):
        return chat_jobs.cancel(job_id, session_hash)
    @app.get("/confirmations")
    def confirmations(session_hash: str = Depends(session_dep)): return {"items": tools.pending_confirmations(session_hash)}
    @app.post("/confirmations/{confirmation_id}/approve")
    def approve(confirmation_id: str, session_hash: str = Depends(session_dep)): return tools.approve(confirmation_id, session_hash)
    @app.post("/confirmations/{confirmation_id}/reject")
    def reject(confirmation_id: str, session_hash: str = Depends(session_dep)): return tools.reject(confirmation_id, session_hash)
    @app.get("/logs")
    def logs(limit: int = 50, session_hash: str = Depends(session_dep)):
        if not settings.allow_logs_endpoint:
            raise HTTPException(status_code=404, detail="Logs endpoint is disabled")
        return {"items": store.recent_logs(limit)}
    return app
app = create_app()
