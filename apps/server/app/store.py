from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from .redaction import redact


def now_iso() -> str:
    return datetime.now(UTC).isoformat()

class Store:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init(self) -> None:
        with self.connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);
                CREATE TABLE IF NOT EXISTS confirmations (id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, tool TEXT NOT NULL, request_id TEXT, arguments_json TEXT NOT NULL, summary TEXT NOT NULL, risk TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, approved_at TEXT, rejected_at TEXT, executed_at TEXT);
                CREATE TABLE IF NOT EXISTS tool_call_cancellations (session_hash TEXT NOT NULL, request_id TEXT NOT NULL, canceled_at TEXT NOT NULL, PRIMARY KEY(session_hash, request_id));
                CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, session_hash TEXT, event_type TEXT NOT NULL, tool TEXT, request_id TEXT, status TEXT NOT NULL, redacted_payload TEXT NOT NULL, error_code TEXT);
                CREATE TABLE IF NOT EXISTS readiness_checks (id INTEGER PRIMARY KEY CHECK (id = 1), checked_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
                CREATE INDEX IF NOT EXISTS idx_confirm_session ON confirmations(session_hash, expires_at, executed_at);
            """)
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(confirmations)")}
            if "request_id" not in columns:
                conn.execute("ALTER TABLE confirmations ADD COLUMN request_id TEXT")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_confirm_request ON confirmations(session_hash, request_id)")

    def log(self, event_type: str, status: str, payload: dict[str, Any] | None = None, session_hash: str | None = None, tool: str | None = None, request_id: str | None = None, error_code: str | None = None) -> None:
        safe_payload = redact(payload or {})
        with self.connect() as conn:
            conn.execute("INSERT INTO audit_logs(timestamp, session_hash, event_type, tool, request_id, status, redacted_payload, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (now_iso(), session_hash, event_type, tool, request_id, status, json.dumps(safe_payload, sort_keys=True), error_code))

    def check_writeable(self) -> bool:
        conn = self.connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "INSERT INTO readiness_checks(id, checked_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at",
                (now_iso(),),
            )
            conn.rollback()
            return True
        except sqlite3.Error:
            conn.rollback()
            return False
        finally:
            conn.close()

    def prune_audit_logs(self, retention_days: int, max_rows: int) -> dict[str, int]:
        deleted = {"age": 0, "rows": 0}
        with self.connect() as conn:
            if retention_days > 0:
                cutoff = (datetime.now(UTC) - timedelta(days=retention_days)).isoformat()
                age_result = conn.execute("DELETE FROM audit_logs WHERE timestamp < ?", (cutoff,))
                deleted["age"] = age_result.rowcount
            if max_rows > 0:
                rows_result = conn.execute(
                    """
                    DELETE FROM audit_logs
                    WHERE id NOT IN (
                        SELECT id FROM audit_logs ORDER BY id DESC LIMIT ?
                    )
                    """,
                    (max_rows,),
                )
                deleted["rows"] = rows_result.rowcount
        return deleted

    def recent_logs(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?", (min(limit, 100),)).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row) | {"redacted_payload": json.loads(row["redacted_payload"])}
            if item.get("session_hash"):
                item["session_hash"] = "[REDACTED]"
            items.append(item)
        return items
