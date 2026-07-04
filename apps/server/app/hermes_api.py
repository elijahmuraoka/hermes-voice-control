from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect

from .adapters import AdapterResult, DEFAULT_AGENT_NAME, HermesAdapter
from .store import Store

DEFAULT_HERMES_API_URL = "ws://127.0.0.1:9119/api/ws"
READY_EVENT = "gateway.ready"
FINAL_STATUSES = {"complete", "completed"}
MAX_SEED_MESSAGES = 10
MAX_SEED_MESSAGE_CHARS = 4000


class HermesApiError(Exception):
    def __init__(self, code: str, message: str, *, rpc_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.rpc_code = rpc_code


class HermesApiRpcError(HermesApiError):
    pass


def _close_code(exc: ConnectionClosed) -> int | None:
    frame = getattr(exc, "rcvd", None)
    code = getattr(frame, "code", None)
    return int(code) if code is not None else None


def _endpoint_label(api_url: str) -> str:
    parts = urlsplit(api_url or DEFAULT_HERMES_API_URL)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def _url_with_token(api_url: str, token: str) -> str:
    parts = urlsplit(api_url or DEFAULT_HERMES_API_URL)
    query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key != "token"]
    query.append(("token", token))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _seed_messages(transcript_window: list[dict] | None) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    for item in (transcript_window or [])[-MAX_SEED_MESSAGES:]:
        role = str(item.get("role") or "").strip().lower()
        if role in {"agent", "assistant", "model"}:
            role = "assistant"
        if role not in {"user", "assistant", "system"}:
            continue
        text = str(item.get("content") or item.get("text") or "").strip()
        if not text:
            continue
        messages.append({"role": role, "content": text[-MAX_SEED_MESSAGE_CHARS:]})
    return messages


def _payload_text(payload: dict[str, Any] | None) -> str:
    if not isinstance(payload, dict):
        return ""
    for key in ("text", "rendered", "content"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


class _HermesRpc:
    def __init__(self, ws: Any, timeout_seconds: int):
        self.ws = ws
        self.timeout_seconds = timeout_seconds
        self._pending: list[dict[str, Any]] = []
        self._next_id = 1

    def expect_ready(self) -> None:
        deadline = time.monotonic() + min(self.timeout_seconds, 15)
        while time.monotonic() < deadline:
            frame = self.recv(deadline - time.monotonic())
            if frame.get("method") == "event":
                params = frame.get("params") if isinstance(frame.get("params"), dict) else {}
                if params.get("type") == READY_EVENT:
                    return
            self._pending.append(frame)
        raise HermesApiError("HERMES_API_TIMEOUT", "Hermes serve did not send gateway.ready before the timeout.")

    def recv(self, timeout: float | None = None) -> dict[str, Any]:
        if self._pending:
            return self._pending.pop(0)
        try:
            raw = self.ws.recv(timeout=max(timeout or 0.1, 0.001))
        except TimeoutError as exc:
            raise HermesApiError("HERMES_API_RECV_TIMEOUT", "Timed out waiting for Hermes serve.") from exc
        if not isinstance(raw, str):
            raise HermesApiError("HERMES_API_BAD_FRAME", "Hermes serve returned a non-text WebSocket frame.")
        try:
            frame = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HermesApiError("HERMES_API_BAD_FRAME", "Hermes serve returned malformed JSON.") from exc
        if not isinstance(frame, dict):
            raise HermesApiError("HERMES_API_BAD_FRAME", "Hermes serve returned a non-object JSON frame.")
        return frame

    def call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        request_id = self._next_id
        self._next_id += 1
        self.ws.send(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}, separators=(",", ":")))
        deadline = time.monotonic() + self.timeout_seconds
        while time.monotonic() < deadline:
            try:
                frame = self.recv(deadline - time.monotonic())
            except HermesApiError as exc:
                if exc.code == "HERMES_API_RECV_TIMEOUT":
                    continue
                raise
            if frame.get("id") == request_id:
                error = frame.get("error")
                if isinstance(error, dict):
                    raise HermesApiRpcError(
                        "HERMES_API_RPC_ERROR",
                        str(error.get("message") or "Hermes serve returned an RPC error."),
                        rpc_code=error.get("code") if isinstance(error.get("code"), int) else None,
                    )
                result = frame.get("result")
                return result if isinstance(result, dict) else {}
            self._pending.append(frame)
        raise HermesApiError("HERMES_API_TIMEOUT", f"Hermes serve did not answer {method} before the timeout.")


class ApiHermesAdapter(HermesAdapter):
    def __init__(
        self,
        api_url: str = DEFAULT_HERMES_API_URL,
        token: str = "",
        store: Store | None = None,
        timeout_seconds: int = 90,
        agent_name: str = DEFAULT_AGENT_NAME,
        cwd: str = "",
    ):
        self.api_url = api_url or DEFAULT_HERMES_API_URL
        self.token = token
        self.store = store
        self.timeout_seconds = timeout_seconds
        self.agent_name = agent_name
        self.cwd = cwd

    def diagnostics(self) -> dict[str, Any]:
        return {
            "kind": "api",
            "available": bool(self.token),
            "endpoint": _endpoint_label(self.api_url),
            "stateful": True,
            "transport": "websocket_jsonrpc",
            "token_configured": bool(self.token),
            "timeout_seconds": self.timeout_seconds,
        }

    def ask_agent(
        self,
        message: str,
        mode: str = "quick",
        transcript_window: list[dict] | None = None,
        should_cancel: Callable[[], bool] | None = None,
        session_hash: str | None = None,
        on_partial: Callable[[str], None] | None = None,
    ) -> AdapterResult:
        trace, started = self._new_trace()
        if not self.token:
            return self._failure("HERMES_API_TOKEN_MISSING", "Hermes serve token is not configured.", trace, started)
        try:
            with connect(
                _url_with_token(self.api_url, self.token),
                open_timeout=min(self.timeout_seconds, 10),
                close_timeout=2,
                ping_interval=None,
                proxy=None,
            ) as ws:
                rpc = _HermesRpc(ws, self.timeout_seconds)
                self._mark(trace, started, "connected")
                rpc.expect_ready()
                self._mark(trace, started, "gateway_ready")
                runtime_session_id = self._open_session(rpc, session_hash, transcript_window, trace, started)
                rpc.call("prompt.submit", {"session_id": runtime_session_id, "text": message.strip()})
                self._mark(trace, started, "prompt_submitted")
                return self._collect_response(rpc, runtime_session_id, mode, should_cancel, on_partial, trace, started)
        except ConnectionClosed as exc:
            code = _close_code(exc)
            error_code = "HERMES_API_UNAUTHORIZED" if code == 4401 else "HERMES_API_CONNECTION_CLOSED"
            return self._failure(error_code, "Hermes serve closed the connection.", trace, started)
        except InvalidStatus:
            return self._failure("HERMES_API_UNAUTHORIZED", "Hermes serve rejected the WebSocket connection.", trace, started)
        except OSError:
            return self._failure("HERMES_API_UNREACHABLE", "Hermes serve is not reachable.", trace, started)
        except HermesApiError as exc:
            return self._failure(exc.code, "The Hermes agent could not answer through Hermes serve right now.", trace, started)

    def _open_session(
        self,
        rpc: _HermesRpc,
        session_hash: str | None,
        transcript_window: list[dict] | None,
        trace: dict[str, Any],
        started: float,
    ) -> str:
        stored_session_id = None
        if self.store is not None and session_hash:
            row = self.store.get_hermes_api_session(session_hash)
            stored_session_id = row["stored_session_id"] if row else None
        if stored_session_id:
            try:
                result = rpc.call(
                    "session.resume",
                    {"session_id": stored_session_id, "close_on_disconnect": False, "eager_build": True},
                )
                runtime_id = str(result.get("session_id") or "")
                stored_id = str(result.get("resumed") or stored_session_id)
                if runtime_id and self.store is not None and session_hash:
                    self.store.upsert_hermes_api_session(session_hash, stored_id, runtime_id)
                trace["resumed"] = True
                self._mark(trace, started, "session_resumed")
                return runtime_id
            except HermesApiRpcError as exc:
                if exc.rpc_code != 4007:
                    raise
        params: dict[str, Any] = {
            "title": f"{self.agent_name} voice",
            "messages": _seed_messages(transcript_window),
            "close_on_disconnect": False,
            "source": "hvc",
        }
        if self.cwd:
            params["cwd"] = self.cwd
        result = rpc.call("session.create", params)
        runtime_id = str(result.get("session_id") or "")
        stored_id = str(result.get("stored_session_id") or runtime_id)
        if not runtime_id:
            raise HermesApiError("HERMES_API_BAD_RESPONSE", "Hermes serve did not return a runtime session id.")
        if self.store is not None and session_hash:
            self.store.upsert_hermes_api_session(session_hash, stored_id, runtime_id)
        trace["resumed"] = False
        trace["seed_messages"] = len(params["messages"])
        self._mark(trace, started, "session_created")
        return runtime_id

    def _collect_response(
        self,
        rpc: _HermesRpc,
        runtime_session_id: str,
        mode: str,
        should_cancel: Callable[[], bool] | None,
        on_partial: Callable[[str], None] | None,
        trace: dict[str, Any],
        started: float,
    ) -> AdapterResult:
        parts: list[str] = []
        deadline = time.monotonic() + self.timeout_seconds
        while time.monotonic() < deadline:
            if should_cancel and should_cancel():
                self._interrupt(rpc, runtime_session_id, trace, started)
                return AdapterResult(ok=False, error_code="HERMES_CANCELLED", safe_message="Tool call was cancelled.", diagnostics=self._finish(trace, started, "HERMES_CANCELLED"))
            try:
                frame = rpc.recv(min(deadline - time.monotonic(), 0.2))
            except HermesApiError as exc:
                if exc.code == "HERMES_API_RECV_TIMEOUT":
                    continue
                raise
            event = self._event(frame, runtime_session_id)
            if event is None:
                continue
            event_type, payload = event
            if event_type == "approval.request":
                self._mark(trace, started, "approval_requested")
                text = "Hermes needs approval on desktop before it can continue."
                return AdapterResult(
                    ok=True,
                    status="pending_confirmation",
                    data={"speakable": text, "display": text, "mode": mode, "approval_required": True},
                    diagnostics=self._finish(trace, started),
                )
            if event_type == "message.delta":
                delta = _payload_text(payload)
                if delta:
                    parts.append(delta)
                    partial = "".join(parts)
                    trace["partial_updates"] += 1
                    if on_partial:
                        on_partial(partial)
                continue
            if event_type == "message.complete":
                final = _payload_text(payload) or "".join(parts).strip()
                status = str((payload or {}).get("status") or "complete").lower()
                if status not in FINAL_STATUSES:
                    return self._failure("HERMES_API_TURN_FAILED", "The Hermes agent could not finish that turn.", trace, started)
                if not final:
                    return self._failure("HERMES_API_EMPTY_RESPONSE", "Local Hermes returned an empty response.", trace, started)
                self._mark(trace, started, "completion")
                return AdapterResult(ok=True, data={"speakable": final, "display": final, "mode": mode}, diagnostics=self._finish(trace, started))
            if event_type == "error":
                return self._failure("HERMES_API_ERROR", "The Hermes agent could not answer right now.", trace, started)
        return self._failure("HERMES_API_TIMEOUT", "The Hermes agent took too long to answer.", trace, started)

    def _event(self, frame: dict[str, Any], runtime_session_id: str) -> tuple[str, dict[str, Any] | None] | None:
        if frame.get("method") != "event":
            return None
        params = frame.get("params") if isinstance(frame.get("params"), dict) else {}
        event_session_id = str(params.get("session_id") or "")
        if event_session_id and event_session_id != runtime_session_id:
            return None
        event_type = str(params.get("type") or "")
        payload = params.get("payload") if isinstance(params.get("payload"), dict) else None
        return (event_type, payload)

    def _interrupt(self, rpc: _HermesRpc, runtime_session_id: str, trace: dict[str, Any], started: float) -> None:
        try:
            rpc.call("session.interrupt", {"session_id": runtime_session_id})
            trace["interrupt_sent"] = True
            self._mark(trace, started, "interrupted")
        except HermesApiError:
            trace["interrupt_sent"] = False

    def _new_trace(self) -> tuple[dict[str, Any], float]:
        return (
            {
                "adapter": "api_hermes",
                "endpoint": _endpoint_label(self.api_url),
                "partial_updates": 0,
                "phases": [],
            },
            time.monotonic(),
        )

    def _mark(self, trace: dict[str, Any], started: float, name: str) -> None:
        trace["phases"].append({"name": name, "elapsed_ms": round((time.monotonic() - started) * 1000)})

    def _finish(self, trace: dict[str, Any], started: float, error_code: str | None = None) -> dict[str, Any]:
        trace["duration_ms"] = round((time.monotonic() - started) * 1000)
        if error_code:
            trace["error_code"] = error_code
        return trace

    def _failure(self, error_code: str, safe_message: str, trace: dict[str, Any], started: float) -> AdapterResult:
        self._mark(trace, started, error_code.lower())
        return AdapterResult(ok=False, error_code=error_code, safe_message=safe_message, diagnostics=self._finish(trace, started, error_code))
