from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
LOCAL_CLIENT_HOSTS = {"127.0.0.1", "localhost", "::1", "testclient"}
DEFAULT_PIN = "000000"
COMMON_WEAK_PINS = {"12345678", "87654321", "password", "password1", "aaaaaaaa", "11111111", "00000000", "qwertyui", "change-me", "changeme"}
HERMES_TIMEOUT_SECONDS_MIN = 1
HERMES_TIMEOUT_SECONDS_MAX = 600
CHAT_JOB_INTERACTIVE_BUDGET_MS_MIN = 0
CHAT_JOB_INTERACTIVE_BUDGET_MS_MAX = 30_000


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
    agent_name: str = "Hermes Agent"
    hermes_bin: str = "hermes"
    hermes_api_url: str = "ws://127.0.0.1:9119/api/ws"
    hermes_api_token: str = ""
    hermes_api_cwd: str = ""
    hermes_timeout_seconds: int = 90
    allow_remote_bind: bool = False
    allow_no_pin_remote: bool = False
    allow_logs_endpoint: bool = False
    audit_log_retention_days: int = 30
    audit_log_max_rows: int = 5_000
    secure_cookies: bool = False
    debug_errors: bool = False
    chat_job_interactive_budget_ms: int = 750

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
            agent_name=os.getenv("HVC_AGENT_NAME", os.getenv("VITE_HVC_AGENT_NAME", "Hermes Agent")),
            hermes_bin=os.getenv("HVC_HERMES_BIN", "hermes"),
            hermes_api_url=os.getenv("HVC_HERMES_API_URL", "ws://127.0.0.1:9119/api/ws"),
            hermes_api_token=os.getenv("HVC_HERMES_API_TOKEN", os.getenv("HERMES_DASHBOARD_SESSION_TOKEN", "")),
            hermes_api_cwd=os.getenv("HVC_HERMES_API_CWD", ""),
            hermes_timeout_seconds=env_int("HVC_HERMES_TIMEOUT_SECONDS", 90),
            allow_remote_bind=env_bool("HVC_ALLOW_REMOTE_BIND", False),
            allow_no_pin_remote=env_bool("HVC_ALLOW_NO_PIN_REMOTE", False),
            allow_logs_endpoint=env_bool("HVC_ALLOW_LOGS_ENDPOINT", False),
            audit_log_retention_days=env_int("HVC_AUDIT_LOG_RETENTION_DAYS", 30),
            audit_log_max_rows=env_int("HVC_AUDIT_LOG_MAX_ROWS", 5000),
            secure_cookies=env_bool("HVC_SECURE_COOKIES", False),
            debug_errors=env_bool("HVC_DEBUG_ERRORS", False),
            chat_job_interactive_budget_ms=env_int("HVC_CHAT_JOB_INTERACTIVE_BUDGET_MS", 750),
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

    def assert_safe_hermes(self) -> None:
        if not HERMES_TIMEOUT_SECONDS_MIN <= self.hermes_timeout_seconds <= HERMES_TIMEOUT_SECONDS_MAX:
            raise RuntimeError("HVC_HERMES_TIMEOUT_SECONDS must be between 1 and 600 seconds")
        if not CHAT_JOB_INTERACTIVE_BUDGET_MS_MIN <= self.chat_job_interactive_budget_ms <= CHAT_JOB_INTERACTIVE_BUDGET_MS_MAX:
            raise RuntimeError("HVC_CHAT_JOB_INTERACTIVE_BUDGET_MS must be between 0 and 30000 milliseconds")
        if self.hermes_adapter == "api":
            parts = urlsplit(self.hermes_api_url)
            if parts.scheme != "ws" or (parts.hostname or "") not in LOCAL_HOSTS:
                raise RuntimeError("HVC_HERMES_API_URL must be a loopback ws:// URL")
