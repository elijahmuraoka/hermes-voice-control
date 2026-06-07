from __future__ import annotations

import hashlib, hmac, secrets, time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from fastapi import Cookie, Header, HTTPException, Response
from .store import Store, now_iso


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

@dataclass
class SessionRecord:
    token: str
    token_hash: str
    expires_at: datetime

class AuthManager:
    def __init__(self, pin: str, ttl_seconds: int, store: Store):
        self._pin_hash = hash_secret(pin)
        self._ttl_seconds = ttl_seconds
        self._store = store
        self._failures: dict[str, list[float]] = {}

    def _rate_limited(self, key: str) -> bool:
        now = time.time()
        window = [t for t in self._failures.get(key, []) if now - t < 300]
        self._failures[key] = window
        return len(window) >= 5

    def verify_pin(self, pin: str, client_key: str = "local") -> bool:
        if self._rate_limited(client_key):
            raise HTTPException(status_code=429, detail="Too many attempts")
        ok = hmac.compare_digest(hash_secret(pin), self._pin_hash)
        if not ok:
            self._failures.setdefault(client_key, []).append(time.time())
        return ok

    def create_session(self) -> SessionRecord:
        token = secrets.token_urlsafe(32)
        token_hash = hash_secret(token)
        expires = datetime.now(UTC) + timedelta(seconds=self._ttl_seconds)
        with self._store.connect() as conn:
            conn.execute("INSERT INTO sessions(id_hash, created_at, expires_at) VALUES (?, ?, ?)", (token_hash, now_iso(), expires.isoformat()))
        return SessionRecord(token=token, token_hash=token_hash, expires_at=expires)

    def revoke(self, token: str) -> None:
        with self._store.connect() as conn:
            conn.execute("UPDATE sessions SET revoked_at=? WHERE id_hash=?", (now_iso(), hash_secret(token)))

    def validate(self, authorization: str | None = Header(default=None), hvc_session: str | None = Cookie(default=None)) -> str:
        token = hvc_session
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization.split(" ", 1)[1].strip()
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")
        token_hash = hash_secret(token)
        with self._store.connect() as conn:
            row = conn.execute("SELECT * FROM sessions WHERE id_hash=?", (token_hash,)).fetchone()
        if not row or row["revoked_at"]:
            raise HTTPException(status_code=401, detail="Authentication required")
        if datetime.fromisoformat(row["expires_at"]) < datetime.now(UTC):
            raise HTTPException(status_code=401, detail="Session expired")
        return token_hash

    @staticmethod
    def set_cookie(response: Response, token: str, expires_at: datetime, secure: bool = False) -> None:
        response.set_cookie("hvc_session", token, httponly=True, samesite="lax", secure=secure, expires=expires_at)
