from __future__ import annotations

import json, secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError
from .adapters import HermesAdapter
from .store import Store, now_iso

class ToolCallRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=120)
    tool: str = Field(min_length=1, max_length=80)
    arguments: dict[str, Any] = Field(default_factory=dict)

class ToolCancelRequest(BaseModel):
    request_ids: list[str] = Field(min_length=1, max_length=50)

class AskAgentArgs(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    mode: str = Field(default="quick", pattern="^(quick|deep)$")
    transcript_window: list[dict[str, Any]] = Field(default_factory=list)

class ProposedActionArgs(BaseModel):
    summary: str = Field(min_length=1, max_length=1000)
    payload: dict[str, Any] = Field(default_factory=dict)

@dataclass(frozen=True)
class ToolDef:
    name: str
    description: str
    risk: str
    requires_confirmation: bool

TOOLS = {
    "ask_agent": ToolDef("ask_agent", "Ask the configured Hermes agent for a speakable answer.", "low", False),
    "ask_bob": ToolDef("ask_bob", "Compatibility alias for ask_agent.", "low", False),
    "propose_action": ToolDef("propose_action", "Record a proposed action for review. Approval records intent only and does not execute external actions.", "high", True),
}

ADAPTER_DIAGNOSTICS_HEADER = "X-HVC-Adapter-Diagnostics"
ADAPTER_DIAGNOSTICS_RESPONSE_KEY = "_adapter_diagnostics"


def safe_validation_errors(exc: ValidationError) -> list[dict[str, Any]]:
    return [
        {
            "type": error.get("type"),
            "loc": error.get("loc", ()),
            "msg": error.get("msg"),
        }
        for error in exc.errors()
    ]

def adapter_diagnostics_headers(diagnostics: dict[str, Any] | None) -> dict[str, str]:
    if not diagnostics:
        return {}
    return {ADAPTER_DIAGNOSTICS_HEADER: json.dumps(diagnostics, separators=(",", ":"), sort_keys=True)}


def ask_agent_audit_payload(tool: str, args: AskAgentArgs, result_ok: bool, error_code: str | None, diagnostics: dict[str, Any] | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "tool": tool,
        "mode": args.mode,
        "message_chars": len(args.message),
        "transcript_items": len(args.transcript_window),
        "result_present": result_ok,
        "error": error_code,
    }
    if diagnostics:
        payload["adapter_diagnostics"] = diagnostics
    return payload

class ToolService:
    def __init__(self, store: Store, adapter: HermesAdapter):
        self.store = store
        self.adapter = adapter
    def list_tools(self) -> list[dict[str, Any]]:
        return [vars(tool) for tool in TOOLS.values()]
    def _is_cancelled(self, request_id: str, session_hash: str) -> bool:
        with self.store.connect() as conn:
            row = conn.execute("SELECT 1 FROM tool_call_cancellations WHERE session_hash=? AND request_id=?", (session_hash, request_id)).fetchone()
        return row is not None
    def validate_ask_agent_args(self, req: ToolCallRequest, session_hash: str) -> AskAgentArgs:
        try:
            return AskAgentArgs.model_validate(req.arguments)
        except ValidationError as exc:
            self.store.log("tool.denied", "denied", {"tool": req.tool, "validation_error": safe_validation_errors(exc)}, session_hash=session_hash, tool=req.tool, request_id=req.request_id, error_code="INVALID_TOOL_ARGUMENTS")
            raise HTTPException(status_code=422, detail="Invalid tool arguments") from exc
    def call(self, req: ToolCallRequest, session_hash: str, include_adapter_diagnostics: bool = False) -> dict[str, Any]:
        if self._is_cancelled(req.request_id, session_hash):
            self.store.log("tool.cancelled", "cancelled", {"request_id": req.request_id}, session_hash=session_hash, tool=req.tool, request_id=req.request_id)
            raise HTTPException(status_code=409, detail="Tool call was cancelled")
        tool = TOOLS.get(req.tool)
        if not tool:
            self.store.log("tool.denied", "denied", {"tool": req.tool}, session_hash=session_hash, tool=req.tool, request_id=req.request_id, error_code="TOOL_NOT_ALLOWED")
            raise HTTPException(status_code=403, detail="Tool not allowed")
        if req.tool in {"ask_agent", "ask_bob"}:
            args = self.validate_ask_agent_args(req, session_hash)
            result = self.adapter.ask_agent(args.message, mode=args.mode, transcript_window=args.transcript_window, should_cancel=lambda: self._is_cancelled(req.request_id, session_hash))
            if self._is_cancelled(req.request_id, session_hash):
                self.store.log("tool.cancelled", "cancelled", {"request_id": req.request_id, "suppressed_after_adapter": True}, session_hash=session_hash, tool=req.tool, request_id=req.request_id)
                raise HTTPException(status_code=409, detail="Tool call was cancelled")
            self.store.log("tool.call", "completed" if result.ok else "failed", ask_agent_audit_payload(req.tool, args, result.ok, result.error_code, result.diagnostics), session_hash=session_hash, tool=req.tool, request_id=req.request_id, error_code=result.error_code)
            if not result.ok:
                raise HTTPException(
                    status_code=502,
                    detail=result.safe_message or "Tool failed",
                    headers=adapter_diagnostics_headers(result.diagnostics) if include_adapter_diagnostics else None,
                )
            response = {"status": "completed", "result": result.data, "request_id": req.request_id}
            if include_adapter_diagnostics and result.diagnostics:
                response[ADAPTER_DIAGNOSTICS_RESPONSE_KEY] = result.diagnostics
            return response
        if req.tool == "propose_action":
            try:
                args = ProposedActionArgs.model_validate(req.arguments)
            except ValidationError as exc:
                self.store.log("tool.denied", "denied", {"tool": req.tool, "validation_error": safe_validation_errors(exc)}, session_hash=session_hash, tool=req.tool, request_id=req.request_id, error_code="INVALID_TOOL_ARGUMENTS")
                raise HTTPException(status_code=422, detail="Invalid tool arguments") from exc
            confirmation_id = secrets.token_urlsafe(18)
            expires_at = datetime.now(UTC) + timedelta(minutes=5)
            cancelled = False
            with self.store.connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                if conn.execute("SELECT 1 FROM tool_call_cancellations WHERE session_hash=? AND request_id=?", (session_hash, req.request_id)).fetchone():
                    cancelled = True
                else:
                    conn.execute("INSERT INTO confirmations(id, session_hash, tool, request_id, arguments_json, summary, risk, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (confirmation_id, session_hash, req.tool, req.request_id, json.dumps(args.model_dump(), sort_keys=True), args.summary, tool.risk, now_iso(), expires_at.isoformat()))
            if cancelled:
                self.store.log("tool.cancelled", "cancelled", {"request_id": req.request_id}, session_hash=session_hash, tool=req.tool, request_id=req.request_id)
                raise HTTPException(status_code=409, detail="Tool call was cancelled")
            self.store.log("confirmation.created", "pending", {"confirmation_id": confirmation_id, "summary_chars": len(args.summary)}, session_hash=session_hash, tool=req.tool, request_id=req.request_id)
            return {"status": "pending_confirmation", "confirmation_id": confirmation_id, "risk": tool.risk, "summary": args.summary, "request_id": req.request_id}
        raise HTTPException(status_code=403, detail="Tool not allowed")
    def cancel(self, req: ToolCancelRequest, session_hash: str) -> dict[str, Any]:
        canceled_at = now_iso()
        unique_ids = sorted({request_id for request_id in req.request_ids if request_id})
        if not unique_ids:
            raise HTTPException(status_code=422, detail="No request IDs supplied")
        with self.store.connect() as conn:
            conn.executemany(
                "INSERT OR IGNORE INTO tool_call_cancellations(session_hash, request_id, canceled_at) VALUES (?, ?, ?)",
                [(session_hash, request_id, canceled_at) for request_id in unique_ids],
            )
            placeholders = ",".join("?" for _ in unique_ids)
            result = conn.execute(
                f"UPDATE confirmations SET rejected_at=? WHERE session_hash=? AND request_id IN ({placeholders}) AND approved_at IS NULL AND rejected_at IS NULL AND executed_at IS NULL",
                [canceled_at, session_hash, *unique_ids],
            )
        self.store.log("tool.cancelled", "cancelled", {"request_ids": unique_ids, "confirmations_rejected": result.rowcount}, session_hash=session_hash)
        return {"status": "cancelled", "request_ids": unique_ids, "confirmations_rejected": result.rowcount}
    def pending_confirmations(self, session_hash: str) -> list[dict[str, Any]]:
        with self.store.connect() as conn:
            rows = conn.execute("SELECT id, tool, summary, risk, created_at, expires_at FROM confirmations WHERE session_hash=? AND approved_at IS NULL AND rejected_at IS NULL AND executed_at IS NULL ORDER BY created_at DESC", (session_hash,)).fetchall()
        return [dict(row) for row in rows]
    def reject(self, confirmation_id: str, session_hash: str) -> dict[str, str]:
        with self.store.connect() as conn:
            row = conn.execute("SELECT * FROM confirmations WHERE id=? AND session_hash=?", (confirmation_id, session_hash)).fetchone()
            if not row: raise HTTPException(status_code=404, detail="Confirmation not found")
            if row["executed_at"] or row["approved_at"]: raise HTTPException(status_code=409, detail="Confirmation already closed")
            conn.execute("UPDATE confirmations SET rejected_at=? WHERE id=?", (now_iso(), confirmation_id))
        self.store.log("confirmation.rejected", "rejected", {"confirmation_id": confirmation_id}, session_hash=session_hash)
        return {"status": "rejected"}
    def approve(self, confirmation_id: str, session_hash: str) -> dict[str, Any]:
        with self.store.connect() as conn:
            row = conn.execute("SELECT * FROM confirmations WHERE id=? AND session_hash=?", (confirmation_id, session_hash)).fetchone()
            if not row: raise HTTPException(status_code=404, detail="Confirmation not found")
            if row["executed_at"] or row["approved_at"]: raise HTTPException(status_code=409, detail="Confirmation already closed")
            if row["rejected_at"]: raise HTTPException(status_code=409, detail="Confirmation rejected")
            if datetime.fromisoformat(row["expires_at"]) < datetime.now(UTC): raise HTTPException(status_code=410, detail="Confirmation expired")
            conn.execute("UPDATE confirmations SET approved_at=? WHERE id=?", (now_iso(), confirmation_id))
        self.store.log("confirmation.approved", "recorded", {"confirmation_id": confirmation_id, "executed": False}, session_hash=session_hash)
        return {"status": "approved_recorded", "executed": False, "result": {"message": "Approval recorded. No external action was executed."}}
