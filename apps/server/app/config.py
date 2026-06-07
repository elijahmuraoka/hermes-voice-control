from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
LOCAL_CLIENT_HOSTS = {"127.0.0.1", "localhost", "::1", "testclient"}
DEFAULT_PIN = "000000"
COMMON_WEAK_PINS = {"12345678", "87654321", "password", "password1", "aaaaaaaa", "11111111", "00000000", "qwertyui"}


def _is_sequential(value: str) -> bool:
    if not value.isdigit() or len(value) < 4:
        return False
    ascending = "01234567890123456789"
    descending = "98765432109876543210"
    return value in ascending or value in descending


def is_weak_pin(value: str) -> bool:
    stripped = value.strip()
    normalized = stripped.lower()
    if value != stripped:
        return True
    if len(stripped) < 8 or stripped == DEFAULT_PIN:
        return True
    if normalized in COMMON_WEAK_PINS:
        return True
    if len(set(stripped)) == 1:
        return True
    return _is_sequential(stripped)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    return int(value)

@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    frontend_origins: tuple[str, ...] = ("http://127.0.0.1:5173", "http://localhost:5173")
    pin: str = DEFAULT_PIN
    require_pin: bool = False
    session_ttl_seconds: int = 86_400
    db_path: Path = Path("./hvc.sqlite3")
    gemini_mode: str = "mock"
    hermes_adapter: str = "mock"
    hermes_bin: str = "hermes"
    allow_remote_bind: bool = False
    allow_no_pin_remote: bool = False
    allow_logs_endpoint: bool = False
    audit_log_retention_days: int = 30
    audit_log_max_rows: int = 5_000
    secure_cookies: bool = False
    debug_errors: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        origins = os.getenv("HVC_FRONTEND_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
        return cls(
            host=os.getenv("HVC_HOST", "127.0.0.1"),
            port=int(os.getenv("HVC_PORT", "8765")),
            frontend_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
            pin=os.getenv("HVC_PIN", DEFAULT_PIN),
            require_pin=env_bool("HVC_REQUIRE_PIN", False),
            session_ttl_seconds=int(os.getenv("HVC_SESSION_TTL_SECONDS", "86400")),
            db_path=Path(os.getenv("HVC_DB_PATH", "./hvc.sqlite3")),
            gemini_mode=os.getenv("HVC_GEMINI_MODE", "mock"),
            hermes_adapter=os.getenv("HVC_HERMES_ADAPTER", "mock"),
            hermes_bin=os.getenv("HVC_HERMES_BIN", "hermes"),
            allow_remote_bind=env_bool("HVC_ALLOW_REMOTE_BIND", False),
            allow_no_pin_remote=env_bool("HVC_ALLOW_NO_PIN_REMOTE", False),
            allow_logs_endpoint=env_bool("HVC_ALLOW_LOGS_ENDPOINT", False),
            audit_log_retention_days=env_int("HVC_AUDIT_LOG_RETENTION_DAYS", 30),
            audit_log_max_rows=env_int("HVC_AUDIT_LOG_MAX_ROWS", 5000),
            secure_cookies=env_bool("HVC_SECURE_COOKIES", False),
            debug_errors=env_bool("HVC_DEBUG_ERRORS", False),
        )

    def assert_safe_bind(self) -> None:
        if self.host not in LOCAL_HOSTS and not self.allow_remote_bind:
            raise RuntimeError("Refusing to bind non-local host without HVC_ALLOW_REMOTE_BIND=true")

    def assert_safe_cors(self) -> None:
        if "*" in self.frontend_origins:
            raise RuntimeError("Refusing wildcard CORS origins while credentials are enabled")

    def assert_safe_auth(self) -> None:
        if self.require_pin and is_weak_pin(self.pin):
            raise RuntimeError("HVC_REQUIRE_PIN=true requires HVC_PIN to be non-default, at least 8 characters, and not common/repeated/sequential")
