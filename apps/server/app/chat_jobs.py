from __future__ import annotations

import json
import secrets
import threading
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException

from .store import Store
from .tools import ADAPTER_DIAGNOSTICS_HEADER, ADAPTER_DIAGNOSTICS_RESPONSE_KEY, ToolCallRequest, ToolCancelRequest, ToolService

CHAT_JOB_STATES = ("queued", "thinking", "needs_permission", "complete", "cancelled", "failed")
TERMINAL_CHAT_JOB_STATES = {"complete", "cancelled", "failed"}


def internal_chat_job_request_id(job_id: str) -> str:
    return f"chat-job:{job_id}"


@dataclass
class RunningChatJob:
    event: threading.Event = field(default_factory=threading.Event)
    result: dict[str, Any] | None = None
    exception: HTTPException | None = None


class ChatJobService:
    def __init__(self, store: Store, tools: ToolService):
        self.store = store
        self.tools = tools
        self._running: dict[str, RunningChatJob] = {}
        self._lock = threading.Lock()

    def submit(
        self,
        req: ToolCallRequest,
        session_hash: str,
        *,
        budget_ms: int,
        include_adapter_diagnostics: bool = False,
        message_chars: int = 0,
        transcript_items: int = 0,
    ) -> tuple[dict[str, Any] | None, dict[str, Any], HTTPException | None]:
        job_id = secrets.token_urlsafe(18)
        row = self.store.create_chat_job(job_id, session_hash, req.request_id)
        running = RunningChatJob()
        with self._lock:
            self._running[job_id] = running
        self.store.log(
            "chat.job",
            "queued",
            {
                "job_id": job_id,
                "request_id": req.request_id,
                "message_chars": message_chars,
                "transcript_items": transcript_items,
                "state": "queued",
            },
            session_hash=session_hash,
            tool=req.tool,
            request_id=req.request_id,
        )
        thread = threading.Thread(
            target=self._run,
            args=(job_id, session_hash, req, running, include_adapter_diagnostics),
            name=f"hvc-chat-job-{job_id[:8]}",
            daemon=True,
        )
        thread.start()
        if running.event.wait(max(0, budget_ms) / 1000):
            status = self.status(job_id, session_hash) or public_chat_job(row)
            if running.exception:
                return None, status, running.exception
            if running.result is None:
                raise HTTPException(status_code=500, detail="Chat job finished without a result")
            return running.result, status, None
        status = self.status(job_id, session_hash)
        return None, status if status else public_chat_job(row), None

    def status(self, job_id: str, session_hash: str) -> dict[str, Any] | None:
        row = self.store.get_chat_job(job_id, session_hash)
        return public_chat_job(row) if row else None

    def cancel(self, job_id: str, session_hash: str) -> dict[str, Any]:
        row = self.store.get_chat_job(job_id, session_hash)
        if row is None:
            raise HTTPException(status_code=404, detail="Chat job not found")
        if row["state"] in TERMINAL_CHAT_JOB_STATES:
            return public_chat_job(row)
        cancelled = self.store.request_chat_job_cancel(job_id, session_hash)
        if cancelled is None:
            raise HTTPException(status_code=404, detail="Chat job not found")
        if cancelled["state"] in {"complete", "failed"}:
            return public_chat_job(cancelled)
        self.tools.cancel(ToolCancelRequest(request_ids=[internal_chat_job_request_id(job_id)]), session_hash)
        self.store.log(
            "chat.job",
            "cancelled",
            {"job_id": job_id, "request_id": row["request_id"], "state": "cancelled"},
            session_hash=session_hash,
            tool="ask_agent",
            request_id=row["request_id"],
        )
        return public_chat_job(cancelled) if cancelled else public_chat_job(row)

    def _run(
        self,
        job_id: str,
        session_hash: str,
        req: ToolCallRequest,
        running: RunningChatJob,
        include_adapter_diagnostics: bool,
    ) -> None:
        try:
            internal_req = chat_job_tool_request(req, job_id)
            updated = self.store.update_chat_job_state(job_id, session_hash, "thinking", started=True, unless_cancelled=True)
            if updated and chat_job_cancelled(updated):
                self._preserve_cancelled_job(job_id, session_hash, req, running)
                return
            self.store.log(
                "chat.job",
                "thinking",
                {"job_id": job_id, "request_id": req.request_id, "state": "thinking"},
                session_hash=session_hash,
                tool=req.tool,
                request_id=req.request_id,
            )
            result = self.tools.call(internal_req, session_hash, include_adapter_diagnostics=include_adapter_diagnostics)
            result["request_id"] = req.request_id
            if self._preserve_cancelled_job(job_id, session_hash, req, running):
                return
            stored_result = chat_job_stored_result(result, include_adapter_diagnostics)
            state = "needs_permission" if result.get("status") == "pending_confirmation" else "complete"
            updated = self.store.update_chat_job_state(
                job_id,
                session_hash,
                state,
                completed=state == "complete",
                result=stored_result,
                unless_cancelled=True,
            )
            if updated and chat_job_cancelled(updated):
                self._preserve_cancelled_job(job_id, session_hash, req, running)
                return
            self.store.log(
                "chat.job",
                state,
                {"job_id": job_id, "request_id": req.request_id, "state": state, "result_present": True},
                session_hash=session_hash,
                tool=req.tool,
                request_id=req.request_id,
            )
            running.result = result
        except HTTPException as exc:
            if self._preserve_cancelled_job(job_id, session_hash, req, running):
                return
            error = safe_http_error(exc)
            updated = self.store.update_chat_job_state(job_id, session_hash, "failed", completed=True, error=error, unless_cancelled=True)
            if updated and chat_job_cancelled(updated):
                self._preserve_cancelled_job(job_id, session_hash, req, running)
                return
            self.store.log(
                "chat.job",
                "failed",
                {"job_id": job_id, "request_id": req.request_id, "state": "failed", "status_code": exc.status_code},
                session_hash=session_hash,
                tool=req.tool,
                request_id=req.request_id,
                error_code=str(error.get("code") or exc.status_code),
            )
            running.exception = exc
        except Exception as exc:
            if self._preserve_cancelled_job(job_id, session_hash, req, running):
                return
            error = {"status_code": 500, "detail": "Internal server error", "code": "CHAT_JOB_FAILED"}
            updated = self.store.update_chat_job_state(job_id, session_hash, "failed", completed=True, error=error, unless_cancelled=True)
            if updated and chat_job_cancelled(updated):
                self._preserve_cancelled_job(job_id, session_hash, req, running)
                return
            self.store.log(
                "chat.job",
                "failed",
                {"job_id": job_id, "request_id": req.request_id, "state": "failed", "error": type(exc).__name__},
                session_hash=session_hash,
                tool=req.tool,
                request_id=req.request_id,
                error_code="CHAT_JOB_FAILED",
            )
            running.exception = HTTPException(status_code=500, detail="Internal server error")
        finally:
            running.event.set()
            with self._lock:
                self._running.pop(job_id, None)

    def _preserve_cancelled_job(
        self,
        job_id: str,
        session_hash: str,
        req: ToolCallRequest,
        running: RunningChatJob,
    ) -> bool:
        row = self.store.get_chat_job(job_id, session_hash)
        if not row or not chat_job_cancelled(row):
            return False
        self.store.update_chat_job_state(job_id, session_hash, "cancelled", cancelled=True)
        self.store.log(
            "chat.job",
            "cancelled",
            {"job_id": job_id, "request_id": req.request_id, "state": "cancelled", "preserved_terminal_cancel": True},
            session_hash=session_hash,
            tool=req.tool,
            request_id=req.request_id,
        )
        running.exception = HTTPException(status_code=409, detail="Tool call was cancelled")
        return True


def chat_job_stored_result(result: dict[str, Any], include_adapter_diagnostics: bool) -> dict[str, Any]:
    stored = {key: value for key, value in result.items() if key != ADAPTER_DIAGNOSTICS_RESPONSE_KEY}
    diagnostics = result.get(ADAPTER_DIAGNOSTICS_RESPONSE_KEY)
    if include_adapter_diagnostics and isinstance(diagnostics, dict):
        stored["diagnostics"] = diagnostics
    return stored


def adapter_diagnostics_from_headers(headers: dict[str, str] | None) -> dict[str, Any] | None:
    if not headers:
        return None
    value = None
    for name, header_value in headers.items():
        if name.lower() == ADAPTER_DIAGNOSTICS_HEADER.lower():
            value = header_value
            break
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def safe_http_error(exc: HTTPException) -> dict[str, Any]:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    error = {"status_code": exc.status_code, "detail": detail, "code": exc.headers.get("X-Error-Code") if exc.headers else None}
    diagnostics = adapter_diagnostics_from_headers(exc.headers)
    if diagnostics:
        error["diagnostics"] = diagnostics
    return error


def chat_job_tool_request(req: ToolCallRequest, job_id: str) -> ToolCallRequest:
    return ToolCallRequest(request_id=internal_chat_job_request_id(job_id), tool=req.tool, arguments=req.arguments)


def chat_job_cancelled(row: Any) -> bool:
    return row["state"] == "cancelled" or bool(row["cancellation_requested"] or row["cancelled_at"])


def public_chat_job(row: Any) -> dict[str, Any]:
    item = {
        "job_id": row["id"],
        "request_id": row["request_id"],
        "state": row["state"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "started_at": row["started_at"],
        "completed_at": row["completed_at"],
        "cancelled_at": row["cancelled_at"],
        "cancelled": bool(row["cancellation_requested"] or row["cancelled_at"]),
    }
    if row["state"] in {"complete", "needs_permission"} and row["result_json"]:
        item["result"] = json.loads(row["result_json"])
    if row["state"] == "failed" and row["error_json"]:
        item["error"] = json.loads(row["error_json"])
    return item
