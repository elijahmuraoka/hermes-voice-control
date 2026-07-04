from pathlib import Path
import importlib.util
import json
import sys
import sqlite3
import subprocess
import threading
import time
import types
import pytest
from fastapi.testclient import TestClient
from app import gemini as gemini_module
from app.adapters import AdapterResult, HermesAdapter, LocalHermesAdapter
from app.config import Settings
from app.main import create_app
from app.store import Store

TEST_PIN = "voice-9Kq2"

def make_client(tmp_path: Path, **overrides) -> TestClient:
    settings = Settings(pin=TEST_PIN, db_path=tmp_path / "test.sqlite3", allow_logs_endpoint=True, **overrides)
    return TestClient(create_app(settings))
def make_real_gemini_client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings(pin=TEST_PIN, db_path=tmp_path / "test-real-gemini.sqlite3", gemini_mode="real")))
def make_pin_client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings(pin=TEST_PIN, require_pin=True, allow_logs_endpoint=True, db_path=tmp_path / "test-pin.sqlite3")))
def login(client: TestClient) -> str:
    res = client.post("/auth/pin", json={"pin": TEST_PIN})
    assert res.status_code == 200
    assert "session_id" not in res.json()
    token = client.cookies.get("hvc_session")
    assert token
    assert token not in res.text
    return token

def load_script_module(filename: str, module_name: str):
    repo_root = Path(__file__).resolve().parents[3]
    script_path = repo_root / "scripts" / filename
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def load_harness_module():
    return load_script_module("run-local-hermes-harness.py", "hvc_harness")

def load_text_latency_harness_module():
    return load_script_module("run-live-text-latency-harness.py", "hvc_text_latency_harness")
def wait_until(predicate, timeout: float = 2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.02)
    raise AssertionError("condition was not met before timeout")
def wait_for_job_state(client: TestClient, job_id: str, state: str) -> dict:
    def read_matching_state():
        response = client.get(f"/chat/jobs/{job_id}")
        if response.status_code != 200:
            return None
        body = response.json()
        return body if body["state"] == state else None
    return wait_until(read_matching_state)
def pause_tool_call_after_return(client: TestClient) -> tuple[threading.Event, threading.Event]:
    original_call = client.app.state.tools.call
    call_returned = threading.Event()
    release_runner = threading.Event()

    def paused_call(*args, **kwargs):
        try:
            result = original_call(*args, **kwargs)
        except Exception:
            call_returned.set()
            assert release_runner.wait(2)
            raise
        call_returned.set()
        assert release_runner.wait(2)
        return result

    client.app.state.tools.call = paused_call
    return call_returned, release_runner
def wait_for_job_runner_to_finish(client: TestClient, job_id: str) -> bool:
    return wait_until(lambda: job_id not in client.app.state.chat_jobs._running)
def persisted_chat_job(tmp_path: Path, job_id: str) -> dict:
    with sqlite3.connect(tmp_path / "test.sqlite3") as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT state, result_json, error_json FROM chat_jobs WHERE id=?", (job_id,)).fetchone()
    assert row is not None
    return dict(row)
def chat_job_count(tmp_path: Path) -> int:
    with sqlite3.connect(tmp_path / "test.sqlite3") as conn:
        return conn.execute("SELECT COUNT(*) FROM chat_jobs").fetchone()[0]
def audit_log_count(tmp_path: Path, event_type: str, status: str) -> int:
    with sqlite3.connect(tmp_path / "test.sqlite3") as conn:
        return conn.execute("SELECT COUNT(*) FROM audit_logs WHERE event_type=? AND status=?", (event_type, status)).fetchone()[0]
def pause_cancel_before_store_update(client: TestClient) -> tuple[threading.Event, threading.Event]:
    original_cancel = client.app.state.store.request_chat_job_cancel
    cancel_ready = threading.Event()
    release_cancel = threading.Event()

    def paused_cancel(*args, **kwargs):
        cancel_ready.set()
        assert release_cancel.wait(2)
        return original_cancel(*args, **kwargs)

    client.app.state.store.request_chat_job_cancel = paused_cancel
    return cancel_ready, release_cancel
def post_cancel_in_thread(client: TestClient, job_id: str) -> tuple[dict, threading.Thread]:
    result: dict = {}

    def run_cancel():
        result["response"] = client.post(f"/chat/jobs/{job_id}/cancel")

    thread = threading.Thread(target=run_cancel)
    thread.start()
    return result, thread
def test_health_has_no_secrets(tmp_path):
    res = make_client(tmp_path).get("/healthz"); assert res.status_code == 200; assert res.json() == {"ok": True}
def test_pin_unlock_sets_device_cookie(tmp_path):
    client = make_pin_client(tmp_path)
    login(client)
    device = client.cookies.get("hvc_device")
    assert device
def test_device_cookie_refreshes_missing_session(tmp_path):
    client = make_pin_client(tmp_path)
    login(client)
    device = client.cookies.get("hvc_device")
    client.cookies.delete("hvc_session")
    res = client.get("/auth/session")
    assert res.status_code == 200
    assert client.cookies.get("hvc_session")
    assert client.cookies.get("hvc_device") == device
def test_device_refresh_disabled_by_setting(tmp_path):
    settings = Settings(pin=TEST_PIN, require_pin=True, remember_device=False, db_path=tmp_path / "test-nodev.sqlite3")
    client = TestClient(create_app(settings))
    login(client)
    assert not client.cookies.get("hvc_device")
    client.cookies.delete("hvc_session")
    assert client.get("/auth/session").status_code == 401
def test_device_refresh_cookie_survives_jsonresponse_endpoints(tmp_path):
    client = make_pin_client(tmp_path)
    login(client)
    client.cookies.delete("hvc_session")
    res = client.post("/chat/text", json={"message": "hello", "job": True})
    assert res.status_code in (200, 202)
    assert "hvc_session" in res.headers.get("set-cookie", "")
    job_id = res.headers["X-HVC-Chat-Job-Id"]
    client.cookies.delete("hvc_session")
    poll = client.get(f"/chat/jobs/{job_id}")
    assert poll.status_code == 404  # job belongs to the refreshed session, not a re-refreshed one
    res2 = client.post("/chat/text", json={"message": "again", "job": True})
    assert not res2.headers.get("set-cookie")  # refreshed session B persisted; no re-mint
    job2 = res2.headers["X-HVC-Chat-Job-Id"]
    poll2 = client.get(f"/chat/jobs/{job2}")
    assert poll2.status_code == 200  # same session reused across submit+poll
def test_logout_revokes_device_token(tmp_path):
    client = make_pin_client(tmp_path)
    login(client)
    device = client.cookies.get("hvc_device")
    assert client.post("/auth/logout").status_code == 200
    client.cookies.clear()
    client.cookies.set("hvc_device", device)
    assert client.get("/auth/session").status_code == 401
def test_readyz_reports_safe_runtime_posture(tmp_path):
    res = make_client(tmp_path).get("/readyz")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["gemini_mode"] == "mock"
    assert body["checks"]["gemini_voice_name"] == "Charon"
    assert body["checks"]["gemini_api_key_configured"] is False
    assert body["checks"]["gemini_client_available"] is True
    assert body["checks"]["hermes"] == {"kind": "mock", "available": True, "read_only": True}
    assert body["checks"]["audit_log_retention_days"] == 30
    assert body["checks"]["audit_log_max_rows"] == 5000
    assert TEST_PIN not in res.text

def test_readyz_reports_missing_local_hermes_binary(tmp_path):
    client = make_client(tmp_path, hermes_adapter="local", hermes_bin=str(tmp_path / "missing-hermes"))
    res = client.get("/readyz")
    assert res.status_code == 503
    body = res.json()
    assert body["ok"] is False
    assert body["checks"]["hermes"]["kind"] == "local"
    assert body["checks"]["hermes"]["available"] is False
    assert body["checks"]["hermes"]["read_only"] is True
    assert body["checks"]["hermes"]["command"][-2:] == ["--toolsets", "safe"]
    assert body["checks"]["hermes"]["command_mode"] == "quiet_chat_query"

def test_readyz_rejects_directory_local_hermes_binary(tmp_path):
    hermes_dir = tmp_path / "hermes-dir"
    hermes_dir.mkdir()
    hermes_dir.chmod(0o755)
    client = make_client(tmp_path, hermes_adapter="local", hermes_bin=str(hermes_dir))
    res = client.get("/readyz")
    assert res.status_code == 503
    body = res.json()
    assert body["ok"] is False
    assert body["checks"]["hermes"]["available"] is False

def test_readyz_reports_resolved_local_hermes_binary(tmp_path):
    hermes = tmp_path / "hermes"
    hermes.write_text("#!/bin/sh\nexit 0\n")
    hermes.chmod(0o755)
    client = make_client(tmp_path, hermes_adapter="local", hermes_bin=str(hermes))
    res = client.get("/readyz")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["checks"]["hermes"]["available"] is True
    assert body["checks"]["hermes"]["resolved_bin"] == str(hermes)

def test_readyz_fails_real_gemini_without_key(tmp_path, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    res = make_real_gemini_client(tmp_path).get("/readyz")
    assert res.status_code == 503
    assert res.json()["ok"] is False
    assert res.json()["checks"]["gemini_mode"] == "real"
def test_readyz_fails_real_gemini_without_client(tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "super-secret-gemini-key")
    monkeypatch.setattr(gemini_module, "google_genai_available", lambda: False)
    res = make_real_gemini_client(tmp_path).get("/readyz")
    assert res.status_code == 503
    assert res.json()["ok"] is False
    assert res.json()["checks"]["gemini_api_key_configured"] is True
    assert res.json()["checks"]["gemini_client_available"] is False
def test_readyz_reports_database_connection_failure(tmp_path, monkeypatch):
    client = make_client(tmp_path)
    def fail_connect():
        raise sqlite3.OperationalError("cannot open database")
    monkeypatch.setattr(client.app.state.store, "connect", fail_connect)
    res = client.get("/readyz")
    assert res.status_code == 503
    assert res.json()["ok"] is False
    assert res.json()["checks"]["database"] == "failed"
def test_pin_auth_and_session(tmp_path):
    client = make_pin_client(tmp_path); assert client.post("/auth/pin", json={"pin": "wrong"}).status_code == 401
    token = login(client); assert client.get("/auth/session", headers={"Authorization": f"Bearer {token}"}).status_code == 200

def test_pin_login_uses_httponly_cookie_without_body_token(tmp_path):
    client = make_pin_client(tmp_path)
    res = client.post("/auth/pin", json={"pin": TEST_PIN})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert set(body) == {"ok", "expires_at"}
    assert "hvc_session=" in res.headers["set-cookie"]
    assert "httponly" in res.headers["set-cookie"].lower()
    assert "samesite=lax" in res.headers["set-cookie"].lower()
    assert "session_id" not in res.text
    assert client.cookies.get("hvc_session") not in res.text
    assert client.get("/auth/session").status_code == 200

def test_pin_cookie_can_be_marked_secure(tmp_path):
    client = TestClient(create_app(Settings(pin=TEST_PIN, require_pin=True, secure_cookies=True, db_path=tmp_path / "secure-cookie.sqlite3")))
    res = client.post("/auth/pin", json={"pin": TEST_PIN})
    assert res.status_code == 200
    assert "secure" in res.headers["set-cookie"].lower()
def test_pin_endpoint_disabled_by_default(tmp_path):
    client = make_client(tmp_path)
    assert client.post("/auth/pin", json={"pin": "12345678"}).status_code == 404
def test_tailscale_mode_allows_local_session_without_pin(tmp_path):
    client = make_client(tmp_path)
    assert client.get("/auth/session").json() == {"authenticated": True, "mode": "tailscale"}
    assert client.post("/gemini/ephemeral-token").status_code == 200

def test_no_pin_mode_rejects_non_local_clients_without_explicit_override(tmp_path):
    client = TestClient(create_app(Settings(pin=TEST_PIN, db_path=tmp_path / "remote.sqlite3")), client=("100.96.34.85", 1234))
    assert client.get("/auth/session").status_code == 401

def test_no_pin_mode_rejects_local_reverse_proxy_without_explicit_override(tmp_path):
    client = make_client(tmp_path)
    assert client.get("/auth/session", headers={"X-Forwarded-For": "100.96.34.85"}).status_code == 401
    assert client.get("/auth/session", headers={"X-Forwarded-Host": "node.tailnet.ts.net"}).status_code == 401
    assert client.get("/auth/session", headers={"X-Forwarded-Proto": "https"}).status_code == 401
    assert client.get("/auth/session", headers={"Tailscale-User-Login": "user@example.com"}).status_code == 401

def test_no_pin_mode_rejects_non_local_host_header_without_explicit_override(tmp_path):
    client = make_client(tmp_path)
    assert client.get("/auth/session", headers={"Host": "node.tailnet.ts.net"}).status_code == 401

def test_no_pin_remote_requires_explicit_override(tmp_path):
    client = TestClient(create_app(Settings(pin=TEST_PIN, allow_no_pin_remote=True, db_path=tmp_path / "remote-ok.sqlite3")), client=("100.96.34.85", 1234))
    assert client.get("/auth/session").status_code == 200

def test_pin_mode_protected_endpoints_require_auth(tmp_path):
    client = make_pin_client(tmp_path); assert client.post("/gemini/ephemeral-token").status_code == 401
    assert client.post("/tools/call", json={"request_id": "r", "tool": "ask_agent", "arguments": {"message": "hi"}}).status_code == 401

def test_pin_mode_requires_non_default_strong_pin(tmp_path):
    with pytest.raises(RuntimeError):
        create_app(Settings(require_pin=True, db_path=tmp_path / "default-pin.sqlite3"))
    for weak_pin in ("1234567", "12345678", "87654321", "aaaaaaaa", "password", "change-me", "changeme", "0000000 ", " 1234567"):
        with pytest.raises(RuntimeError):
            create_app(Settings(pin=weak_pin, require_pin=True, db_path=tmp_path / f"weak-{weak_pin}.sqlite3"))


@pytest.mark.parametrize("timeout_seconds", [0, -1, 601])
def test_hermes_timeout_bounds_enforced(tmp_path, timeout_seconds):
    with pytest.raises(RuntimeError, match="HVC_HERMES_TIMEOUT_SECONDS"):
        create_app(
            Settings(
                pin=TEST_PIN,
                db_path=tmp_path / f"timeout-{timeout_seconds}.sqlite3",
                hermes_timeout_seconds=timeout_seconds,
            )
        )


def test_env_hermes_timeout_bounds_enforced(tmp_path, monkeypatch):
    monkeypatch.setenv("HVC_DB_PATH", str(tmp_path / "env-timeout.sqlite3"))
    monkeypatch.setenv("HVC_HERMES_TIMEOUT_SECONDS", "0")

    with pytest.raises(RuntimeError, match="HVC_HERMES_TIMEOUT_SECONDS"):
        create_app()


def test_mock_gemini_token_not_logged_raw(tmp_path):
    client = make_client(tmp_path)
    res = client.post("/gemini/ephemeral-token"); assert res.status_code == 200
    body = res.json()
    gemini_token = body["token"]
    assert body["model"] == "gemini-2.5-flash-native-audio-latest"
    assert body["voice_name"] == "Charon"
    logs = client.get("/logs").text
    assert gemini_token not in logs
    assert "tailscale-local" not in logs
    assert "[REDACTED]" in logs
    assert "token_issued" in logs

def test_logs_endpoint_disabled_by_default(tmp_path):
    client = TestClient(create_app(Settings(pin=TEST_PIN, db_path=tmp_path / "logs-disabled.sqlite3")))
    assert client.post("/gemini/ephemeral-token").status_code == 200
    assert client.get("/logs").status_code == 404

def test_failed_pin_log_does_not_store_supplied_pin(tmp_path):
    client = make_pin_client(tmp_path)
    assert client.post("/auth/pin", json={"pin": "voice-secret-pin"}).status_code == 401
    token = login(client)
    logs = client.get("/logs", headers={"Authorization": f"Bearer {token}"}).text
    assert "voice-secret-pin" not in logs
    assert "pin_supplied" in logs
def test_real_gemini_status_only_reports_key_presence(tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "super-secret-gemini-key")
    res = make_real_gemini_client(tmp_path).get("/gemini/status")
    assert res.status_code == 200
    assert res.json() == {"mode": "real", "api_key_configured": True}
    assert "super-secret-gemini-key" not in res.text

def test_real_gemini_token_is_single_use_and_constrained(monkeypatch):
    created = {}
    class FakeToken:
        name = "ephemeral-token-name"
    class FakeAuthTokens:
        def create(self, config):
            created["config"] = config
            return FakeToken()
    class FakeClient:
        def __init__(self, api_key, http_options):
            created["api_key"] = api_key
            created["http_options"] = http_options
            self.auth_tokens = FakeAuthTokens()
    fake_genai = types.SimpleNamespace(Client=FakeClient)
    fake_google = types.ModuleType("google")
    fake_google.genai = fake_genai
    monkeypatch.setitem(sys.modules, "google", fake_google)
    monkeypatch.setenv("GEMINI_API_KEY", "super-secret-gemini-key")
    monkeypatch.setenv("HVC_GEMINI_MODEL", "gemini-test-model")
    monkeypatch.setenv("HVC_GEMINI_VOICE_NAME", "Orus")
    token = gemini_module.RealGeminiTokenBroker().create_token()
    assert token.token == "ephemeral-token-name"
    assert token.mode == "real"
    assert token.model == "gemini-test-model"
    assert token.voice_name == "Orus"
    assert created["api_key"] == "super-secret-gemini-key"
    assert created["http_options"] == {"api_version": "v1alpha"}
    assert created["config"]["uses"] == 1
    assert created["config"]["live_connect_constraints"] == {
        "model": "gemini-test-model",
        "config": {
            "response_modalities": ["AUDIO"],
            "speech_config": {
                "voice_config": {
                    "prebuilt_voice_config": {"voice_name": "Orus"}
                }
            },
        },
    }
    assert created["config"]["lock_additional_fields"] == []
    assert "super-secret-gemini-key" not in str(created["config"])

def test_tool_allowlist_and_mock_agent(tmp_path):
    client = make_client(tmp_path)
    denied = client.post("/tools/call", json={"request_id": "r1", "tool": "shell", "arguments": {}}); assert denied.status_code == 403
    ok = client.post("/tools/call", json={"request_id": "r2", "tool": "ask_agent", "arguments": {"message": "hello", "mode": "quick"}})
    assert ok.status_code == 200; assert ok.json()["status"] == "completed"; assert "Mock Hermes Agent heard" in ok.json()["result"]["speakable"]
    alias = client.post("/tools/call", json={"request_id": "r2-alias", "tool": "ask_bob", "arguments": {"message": "hello", "mode": "quick"}})
    assert alias.status_code == 200
def test_ask_agent_denies_action_mode(tmp_path):
    client = make_client(tmp_path)
    res = client.post("/tools/call", json={"request_id": "r-action", "tool": "ask_agent", "arguments": {"message": "send it", "mode": "action"}})
    assert res.status_code == 422

def test_ask_agent_audit_log_omits_free_text_inputs_and_outputs(tmp_path):
    client = make_client(tmp_path)
    spoken_secret = "spoken-secret-do-not-store"
    res = client.post("/tools/call", json={
        "request_id": "r-secret",
        "tool": "ask_agent",
        "arguments": {
            "message": f"my token is {spoken_secret}",
            "mode": "quick",
            "transcript_window": [{"role": "user", "text": spoken_secret}],
        },
    })
    assert res.status_code == 200
    assert spoken_secret in res.text
    logs = client.get("/logs").text
    assert spoken_secret not in logs
    assert "Mock Hermes Agent heard" not in logs
    assert "message_chars" in logs
    assert "transcript_items" in logs

def test_invalid_tool_argument_log_omits_pydantic_input(tmp_path):
    client = make_client(tmp_path)
    secret_prefix = "summary-secret-do-not-log"
    res = client.post("/tools/call", json={
        "request_id": "r-invalid-secret",
        "tool": "propose_action",
        "arguments": {"summary": secret_prefix + ("x" * 1100)},
    })
    assert res.status_code == 422
    logs = client.get("/logs").text
    assert secret_prefix not in logs
    assert "validation_error" in logs

def test_chat_text_invalid_payload_uses_sanitized_tool_validation(tmp_path):
    client = make_client(tmp_path)
    secret = "chat-secret-do-not-return"
    oversized_message = secret + ("x" * 9000)

    oversized = client.post("/chat/text", json={"request_id": "text-secret", "message": oversized_message, "mode": "quick"})
    assert oversized.status_code == 422
    assert oversized.json() == {"detail": "Invalid tool arguments"}
    assert secret not in oversized.text

    bad_mode = client.post("/chat/text", json={"request_id": "text-mode", "message": f"please keep {secret} private", "mode": "action"})
    assert bad_mode.status_code == 422
    assert bad_mode.json() == {"detail": "Invalid tool arguments"}
    assert secret not in bad_mode.text

    logs = client.get("/logs").text
    assert secret not in logs
    assert "validation_error" in logs

@pytest.mark.parametrize(
    "payload",
    [
        {"request_id": "job-empty-message", "message": "", "mode": "quick", "job": True, "interactive_budget_ms": 0},
        {"request_id": "job-invalid-mode", "message": "hello", "mode": "action", "job": True, "interactive_budget_ms": 0},
        {"request_id": "job-oversized-message", "message": "x" * 9001, "mode": "quick", "job": True, "interactive_budget_ms": 0},
    ],
)
def test_chat_text_job_invalid_payload_returns_422_without_creating_job(tmp_path, payload):
    client = make_client(tmp_path)

    res = client.post("/chat/text", json=payload)

    assert res.status_code == 422
    assert res.json() == {"detail": "Invalid tool arguments"}
    assert "x-hvc-chat-job-id" not in res.headers
    assert chat_job_count(tmp_path) == 0

def test_chat_text_diagnostics_are_opt_in_and_redacted(tmp_path, monkeypatch):
    hermes = tmp_path / "hermes"
    hermes.write_text("#!/bin/sh\nexit 0\n")
    hermes.chmod(0o755)

    class FakeProc:
        returncode = 0
        def poll(self): return 0
        def communicate(self, timeout=None): return ("safe answer", "")

    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProc())
    client = make_client(tmp_path, hermes_adapter="local", hermes_bin=str(hermes))

    normal = client.post("/chat/text", json={"request_id": "text-normal", "message": "hello", "mode": "quick"})
    assert normal.status_code == 200
    assert "x-hvc-adapter-diagnostics" not in normal.headers
    assert "diagnostics" not in normal.json()

    res = client.post(
        "/chat/text",
        json={"request_id": "text-diag", "message": "hello", "mode": "quick"},
        headers={"Origin": "http://127.0.0.1:5173", "X-HVC-Adapter-Diagnostics": "1"},
    )

    assert res.status_code == 200
    assert "x-hvc-adapter-diagnostics" in res.headers["access-control-expose-headers"].lower()
    diagnostics = json.loads(res.headers["x-hvc-adapter-diagnostics"])
    assert diagnostics["command_mode"] == "quiet_chat_query"
    assert [phase["name"] for phase in diagnostics["phases"]] == [
        "request_start",
        "binary_resolved",
        "process_spawn_start",
        "process_spawned",
        "process_exited",
        "stdio_collected",
        "completion",
    ]
    assert diagnostics["cleanup"]["communicated"] is True
    assert "safe answer" not in json.dumps(diagnostics)
    assert "diagnostics" not in res.json()

def test_chat_text_diagnostics_header_is_cors_accessible(tmp_path):
    res = make_client(tmp_path).options(
        "/chat/text",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-hvc-adapter-diagnostics",
        },
    )
    assert res.status_code == 200
    assert "x-hvc-adapter-diagnostics" in res.headers["access-control-allow-headers"].lower()

def test_chat_text_failure_diagnostics_are_opt_in(tmp_path):
    client = make_client(tmp_path, hermes_adapter="local", hermes_bin=str(tmp_path / "missing-hermes"))

    normal = client.post("/chat/text", json={"request_id": "text-missing-normal", "message": "hello", "mode": "quick"})
    assert normal.status_code == 502
    assert normal.json() == {"detail": "Local Hermes binary was not found."}
    assert "x-hvc-adapter-diagnostics" not in normal.headers

    opt_in = client.post(
        "/chat/text",
        json={"request_id": "text-missing-diag", "message": "hello", "mode": "quick"},
        headers={"X-HVC-Adapter-Diagnostics": "1"},
    )
    assert opt_in.status_code == 502
    diagnostics = json.loads(opt_in.headers["x-hvc-adapter-diagnostics"])
    assert diagnostics["error_code"] == "HERMES_NOT_FOUND"
    assert diagnostics["phases"][-1]["name"] == "binary_missing"
    assert "hello" not in json.dumps(diagnostics)

def test_chat_text_job_fast_failure_returns_job_id_and_persisted_error(tmp_path):
    client = make_client(tmp_path, hermes_adapter="local", hermes_bin=str(tmp_path / "missing-hermes"))

    res = client.post(
        "/chat/text",
        json={"request_id": "job-fast-missing-hermes", "message": "hello", "mode": "quick", "job": True, "interactive_budget_ms": 1000},
        headers={"X-HVC-Adapter-Diagnostics": "1"},
    )

    assert res.status_code == 502
    assert res.json() == {"detail": "Local Hermes binary was not found."}
    job_id = res.headers["x-hvc-chat-job-id"]
    diagnostics = json.loads(res.headers["x-hvc-adapter-diagnostics"])
    assert diagnostics["error_code"] == "HERMES_NOT_FOUND"
    assert diagnostics["phases"][-1]["name"] == "binary_missing"
    status = client.get(f"/chat/jobs/{job_id}")
    assert status.status_code == 200
    body = status.json()
    assert body["state"] == "failed"
    assert body["request_id"] == "job-fast-missing-hermes"
    assert body["error"]["code"] is None
    assert body["error"]["detail"] == "Local Hermes binary was not found."
    assert body["error"]["status_code"] == 502
    assert body["error"]["diagnostics"]["error_code"] == "HERMES_NOT_FOUND"
    assert body["error"]["diagnostics"]["phases"][-1]["name"] == "binary_missing"
    assert "hello" not in json.dumps(body["error"]["diagnostics"])
    assert persisted_chat_job(tmp_path, job_id) == {
        "state": "failed",
        "result_json": None,
        "error_json": json.dumps(body["error"], sort_keys=True),
    }

def test_chat_text_job_fast_response_preserves_completed_body(tmp_path):
    client = make_client(tmp_path)

    res = client.post("/chat/text", json={"request_id": "job-fast", "message": "hello", "mode": "quick", "job": True})

    assert res.status_code == 200
    assert res.json()["status"] == "completed"
    assert "state" not in res.json()
    job_id = res.headers["x-hvc-chat-job-id"]
    status = client.get(f"/chat/jobs/{job_id}")
    assert status.status_code == 200
    body = status.json()
    assert body["state"] == "complete"
    assert body["result"]["request_id"] == "job-fast"

def test_chat_text_job_slow_response_survives_refresh_with_same_session_cookie(tmp_path):
    class SlowAdapter(HermesAdapter):
        def ask_agent(self, message, mode="quick", transcript_window=None, should_cancel=None):
            time.sleep(0.08)
            return AdapterResult(
                ok=True,
                data={"speakable": "slow answer", "display": "slow answer", "mode": mode},
                diagnostics={"adapter": "mock", "duration_ms": 100},
            )

    client = make_pin_client(tmp_path)
    token = login(client)
    client.app.state.tools.adapter = SlowAdapter()

    started = client.post(
        "/chat/text",
        json={"request_id": "job-slow", "message": "hello", "mode": "quick", "job": True, "interactive_budget_ms": 0},
        headers={"X-HVC-Adapter-Diagnostics": "1"},
    )

    assert started.status_code == 202
    job_id = started.json()["job_id"]
    assert started.headers["location"] == f"/chat/jobs/{job_id}"
    assert started.json()["state"] in {"queued", "thinking"}

    refreshed = TestClient(client.app)
    refreshed.cookies.set("hvc_session", token)
    completed = wait_for_job_state(refreshed, job_id, "complete")
    assert completed["result"]["result"]["speakable"] == "slow answer"
    assert completed["result"]["diagnostics"] == {"adapter": "mock", "duration_ms": 100}

def test_chat_text_job_slow_response_exposes_location_for_cors(tmp_path):
    class SlowAdapter(HermesAdapter):
        def ask_agent(self, message, mode="quick", transcript_window=None, should_cancel=None):
            time.sleep(0.05)
            return AdapterResult(ok=True, data={"speakable": "slow answer", "display": "slow answer", "mode": mode})

    client = make_client(tmp_path)
    client.app.state.tools.adapter = SlowAdapter()

    started = client.post(
        "/chat/text",
        json={"request_id": "job-cors", "message": "hello", "mode": "quick", "job": True, "interactive_budget_ms": 0},
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert started.status_code == 202
    assert started.headers["location"] == f"/chat/jobs/{started.json()['job_id']}"
    exposed = started.headers["access-control-expose-headers"].lower()
    assert "location" in exposed
    assert "x-hvc-chat-job-id" in exposed
    wait_for_job_state(client, started.json()["job_id"], "complete")

def test_chat_text_job_cancel_signals_local_hermes_process(tmp_path, monkeypatch):
    hermes = tmp_path / "hermes"
    hermes.write_text("#!/bin/sh\nexit 0\n")
    hermes.chmod(0o755)
    events = []

    class FakeProc:
        returncode = None
        def poll(self): return self.returncode
        def terminate(self):
            events.append("terminate")
            self.returncode = -15
        def kill(self):
            events.append("kill")
            self.returncode = -9
        def communicate(self, timeout=None): return ("", "")

    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProc())
    client = make_client(tmp_path, hermes_adapter="local", hermes_bin=str(hermes), hermes_timeout_seconds=5)

    started = client.post(
        "/chat/text",
        json={"request_id": "job-cancel", "message": "cancel me", "mode": "quick", "job": True, "interactive_budget_ms": 0},
    )
    assert started.status_code == 202
    job_id = started.json()["job_id"]

    cancelled = client.post(f"/chat/jobs/{job_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["state"] == "cancelled"
    wait_until(lambda: events == ["terminate"])
    status = client.get(f"/chat/jobs/{job_id}")
    assert status.json()["cancelled"] is True
    assert "kill" not in events

def test_chat_text_job_cancel_before_thinking_skips_tool_call(tmp_path):
    client = make_client(tmp_path)
    original_update = client.app.state.store.update_chat_job_state
    thinking_ready = threading.Event()
    release_thinking = threading.Event()
    tool_called = threading.Event()

    def paused_thinking_update(job_id, session_hash, state, *args, **kwargs):
        if state == "thinking":
            thinking_ready.set()
            assert release_thinking.wait(2)
        return original_update(job_id, session_hash, state, *args, **kwargs)

    def unexpected_tool_call(*args, **kwargs):
        tool_called.set()
        raise AssertionError("tools.call should not run after cancellation wins before thinking")

    client.app.state.store.update_chat_job_state = paused_thinking_update
    client.app.state.tools.call = unexpected_tool_call

    started = client.post(
        "/chat/text",
        json={"request_id": "job-cancel-before-thinking", "message": "cancel before start", "mode": "quick", "job": True, "interactive_budget_ms": 0},
    )
    assert started.status_code == 202
    job_id = started.json()["job_id"]
    wait_until(lambda: thinking_ready.is_set())

    cancelled = client.post(f"/chat/jobs/{job_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["state"] == "cancelled"
    assert client.get(f"/chat/jobs/{job_id}").json()["state"] == "cancelled"

    release_thinking.set()
    wait_for_job_runner_to_finish(client, job_id)
    final = client.get(f"/chat/jobs/{job_id}").json()
    assert final["state"] == "cancelled"
    assert final["cancelled"] is True
    assert "result" not in final
    assert "error" not in final
    assert tool_called.is_set() is False
    assert persisted_chat_job(tmp_path, job_id) == {"state": "cancelled", "result_json": None, "error_json": None}
    assert audit_log_count(tmp_path, "chat.job", "thinking") == 0

def test_chat_text_job_cancel_does_not_poison_reused_public_request_id(tmp_path):
    class ReusedRequestAdapter(HermesAdapter):
        def __init__(self):
            self.started = 0
            self.lock = threading.Lock()
            self.release = threading.Event()
            self.cancel_seen = threading.Event()

        def ask_agent(self, message, mode="quick", transcript_window=None, should_cancel=None):
            with self.lock:
                self.started += 1
            while not self.release.is_set():
                if should_cancel and should_cancel():
                    self.cancel_seen.set()
                    return AdapterResult(ok=False, error_code="HERMES_CANCELLED", safe_message="Tool call was cancelled.")
                time.sleep(0.01)
            return AdapterResult(ok=True, data={"speakable": f"done: {message}", "display": f"done: {message}", "mode": mode})

    adapter = ReusedRequestAdapter()
    client = make_client(tmp_path)
    client.app.state.tools.adapter = adapter

    first = client.post("/chat/text", json={"message": "one", "mode": "quick", "job": True, "interactive_budget_ms": 0})
    second = client.post("/chat/text", json={"message": "two", "mode": "quick", "job": True, "interactive_budget_ms": 0})

    assert first.status_code == 202
    assert second.status_code == 202
    first_job_id = first.json()["job_id"]
    second_job_id = second.json()["job_id"]
    assert first.json()["request_id"] == "text-chat"
    assert second.json()["request_id"] == "text-chat"
    wait_until(lambda: adapter.started == 2)

    cancelled = client.post(f"/chat/jobs/{first_job_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["state"] == "cancelled"
    wait_until(lambda: adapter.cancel_seen.is_set())

    adapter.release.set()
    second_status = wait_for_job_state(client, second_job_id, "complete")
    assert second_status["request_id"] == "text-chat"
    assert second_status["result"]["request_id"] == "text-chat"
    assert second_status["result"]["result"]["speakable"] == "done: two"

    later = client.post("/chat/text", json={"message": "later", "mode": "quick"})
    assert later.status_code == 200
    assert later.json()["request_id"] == "text-chat"

def test_chat_text_job_cancel_after_tool_return_preserves_cancelled_state(tmp_path):
    class FastAdapter(HermesAdapter):
        def ask_agent(self, message, mode="quick", transcript_window=None, should_cancel=None):
            return AdapterResult(ok=True, data={"speakable": "late success", "display": "late success", "mode": mode})

    client = make_client(tmp_path)
    client.app.state.tools.adapter = FastAdapter()
    call_returned, release_runner = pause_tool_call_after_return(client)

    started = client.post(
        "/chat/text",
        json={"request_id": "job-cancel-after-success", "message": "hello", "mode": "quick", "job": True, "interactive_budget_ms": 0},
    )
    assert started.status_code == 202
    job_id = started.json()["job_id"]
    wait_until(lambda: call_returned.is_set())

    cancelled = client.post(f"/chat/jobs/{job_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["state"] == "cancelled"

    release_runner.set()
    wait_for_job_runner_to_finish(client, job_id)
    status = client.get(f"/chat/jobs/{job_id}").json()
    assert status["state"] == "cancelled"
    assert "result" not in status
    assert persisted_chat_job(tmp_path, job_id) == {"state": "cancelled", "result_json": None, "error_json": None}

def test_chat_text_job_cancel_after_tool_failure_preserves_cancelled_state(tmp_path):
    class FailingAdapter(HermesAdapter):
        def ask_agent(self, message, mode="quick", transcript_window=None, should_cancel=None):
            return AdapterResult(ok=False, error_code="HERMES_TEST_FAILURE", safe_message="The Hermes agent could not answer right now.")

    client = make_client(tmp_path)
    client.app.state.tools.adapter = FailingAdapter()
    call_returned, release_runner = pause_tool_call_after_return(client)

    started = client.post(
        "/chat/text",
        json={"request_id": "job-cancel-after-failure", "message": "hello", "mode": "quick", "job": True, "interactive_budget_ms": 0},
    )
    assert started.status_code == 202
    job_id = started.json()["job_id"]
    wait_until(lambda: call_returned.is_set())

    cancelled = client.post(f"/chat/jobs/{job_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["state"] == "cancelled"

    release_runner.set()
    wait_for_job_runner_to_finish(client, job_id)
    status = client.get(f"/chat/jobs/{job_id}").json()
    assert status["state"] == "cancelled"
    assert "error" not in status
    assert persisted_chat_job(tmp_path, job_id) == {"state": "cancelled", "result_json": None, "error_json": None}

def test_chat_text_job_complete_wins_cancel_after_terminal_check(tmp_path):
    release_adapter = threading.Event()

    class ReleaseAdapter(HermesAdapter):
        def ask_agent(self, message, mode="quick", transcript_window=None, should_cancel=None):
            assert release_adapter.wait(2)
            return AdapterResult(ok=True, data={"speakable": "finished", "display": "finished", "mode": mode})

    client = make_client(tmp_path)
    client.app.state.tools.adapter = ReleaseAdapter()

    started = client.post(
        "/chat/text",
        json={"request_id": "job-complete-wins", "message": "hello", "mode": "quick", "job": True, "interactive_budget_ms": 0},
    )
    assert started.status_code == 202
    job_id = started.json()["job_id"]
    wait_for_job_state(client, job_id, "thinking")
    cancel_ready, release_cancel = pause_cancel_before_store_update(client)
    cancel_result, cancel_thread = post_cancel_in_thread(client, job_id)
    wait_until(lambda: cancel_ready.is_set())

    release_adapter.set()
    completed = wait_for_job_state(client, job_id, "complete")
    release_cancel.set()
    cancel_thread.join(timeout=2)

    assert cancel_thread.is_alive() is False
    assert cancel_result["response"].status_code == 200
    assert cancel_result["response"].json()["state"] == "complete"
    assert cancel_result["response"].json()["result"]["result"]["speakable"] == "finished"
    assert completed["result"]["result"]["speakable"] == "finished"
    persisted = persisted_chat_job(tmp_path, job_id)
    assert persisted["state"] == "complete"
    assert persisted["result_json"] is not None
    assert persisted["error_json"] is None

def test_chat_text_job_failure_wins_cancel_after_terminal_check(tmp_path):
    release_adapter = threading.Event()

    class ReleaseFailingAdapter(HermesAdapter):
        def ask_agent(self, message, mode="quick", transcript_window=None, should_cancel=None):
            assert release_adapter.wait(2)
            return AdapterResult(ok=False, error_code="HERMES_TEST_FAILURE", safe_message="The Hermes agent could not answer right now.")

    client = make_client(tmp_path)
    client.app.state.tools.adapter = ReleaseFailingAdapter()

    started = client.post(
        "/chat/text",
        json={"request_id": "job-failure-wins", "message": "hello", "mode": "quick", "job": True, "interactive_budget_ms": 0},
    )
    assert started.status_code == 202
    job_id = started.json()["job_id"]
    wait_for_job_state(client, job_id, "thinking")
    cancel_ready, release_cancel = pause_cancel_before_store_update(client)
    cancel_result, cancel_thread = post_cancel_in_thread(client, job_id)
    wait_until(lambda: cancel_ready.is_set())

    release_adapter.set()
    failed = wait_for_job_state(client, job_id, "failed")
    release_cancel.set()
    cancel_thread.join(timeout=2)

    assert cancel_thread.is_alive() is False
    assert cancel_result["response"].status_code == 200
    assert cancel_result["response"].json()["state"] == "failed"
    assert cancel_result["response"].json()["error"] == failed["error"]
    persisted = persisted_chat_job(tmp_path, job_id)
    assert persisted["state"] == "failed"
    assert persisted["result_json"] is None
    assert persisted["error_json"] is not None

def test_chat_text_job_failure_is_persisted_as_safe_metadata(tmp_path):
    class FailingAdapter(HermesAdapter):
        def ask_agent(self, message, mode="quick", transcript_window=None, should_cancel=None):
            time.sleep(0.05)
            return AdapterResult(ok=False, error_code="HERMES_TEST_FAILURE", safe_message="The Hermes agent could not answer right now.")

    client = make_client(tmp_path)
    client.app.state.tools.adapter = FailingAdapter()

    started = client.post(
        "/chat/text",
        json={"request_id": "job-failed", "message": "hello", "mode": "quick", "job": True, "interactive_budget_ms": 0},
    )

    assert started.status_code == 202
    job_id = started.json()["job_id"]
    failed = wait_for_job_state(client, job_id, "failed")
    assert failed["error"] == {"code": None, "detail": "The Hermes agent could not answer right now.", "status_code": 502}

def test_chat_text_job_status_is_session_scoped(tmp_path):
    client = make_pin_client(tmp_path)
    login(client)
    created = client.post("/chat/text", json={"request_id": "job-private", "message": "hello", "mode": "quick", "job": True})
    assert created.status_code == 200
    job_id = created.headers["x-hvc-chat-job-id"]

    other = TestClient(client.app)
    login(other)
    hidden = other.get(f"/chat/jobs/{job_id}")

    assert hidden.status_code == 404
    assert hidden.json() == {"detail": "Chat job not found"}

def test_chat_text_job_persistence_omits_raw_prompt_transcript_and_logs(tmp_path):
    class SafeDelayedAdapter(HermesAdapter):
        def ask_agent(self, message, mode="quick", transcript_window=None, should_cancel=None):
            time.sleep(0.05)
            return AdapterResult(ok=True, data={"speakable": "safe final", "display": "safe final", "mode": mode})

    client = make_client(tmp_path)
    client.app.state.tools.adapter = SafeDelayedAdapter()
    secret = "job-secret-do-not-store"

    started = client.post(
        "/chat/text",
        json={
            "request_id": "job-redacted",
            "message": f"please remember {secret}",
            "mode": "quick",
            "transcript_window": [{"role": "user", "text": secret}],
            "job": True,
            "interactive_budget_ms": 0,
        },
    )

    assert started.status_code == 202
    job_id = started.json()["job_id"]
    wait_for_job_state(client, job_id, "complete")
    with sqlite3.connect(tmp_path / "test.sqlite3") as conn:
        conn.row_factory = sqlite3.Row
        rows = [dict(row) for row in conn.execute("SELECT id, request_id, state, result_json, error_json FROM chat_jobs")]
    assert secret not in json.dumps(rows)
    logs = client.get("/logs").text
    assert secret not in logs
    assert "message_chars" in logs
    assert "transcript_items" in logs

def test_local_hermes_adapter_uses_safe_toolset(tmp_path, monkeypatch):
    hermes = tmp_path / "hermes"
    hermes.write_text("#!/bin/sh\nexit 0\n")
    hermes.chmod(0o755)
    calls = []
    class FakeProc:
        returncode = 0
        def poll(self): return 0
        def communicate(self, timeout=None): return ("safe answer", "")
    def fake_popen(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return FakeProc()
    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    result = LocalHermesAdapter(str(hermes)).ask_agent("hi", mode="quick")
    assert result.ok is True
    assert calls[0][0][1:4] == ["chat", "-Q", "-q"]
    assert "You are Hermes Agent" in calls[0][0][4]
    assert "If asked who you are, say you are Hermes Agent" in calls[0][0][4]
    assert "Do not take external actions" in calls[0][0][4]
    assert "mutate files" in calls[0][0][4]
    assert "send messages" in calls[0][0][4]
    assert calls[0][1]["shell"] is False
    assert calls[0][0][-2:] == ["--toolsets", "safe"]
    assert result.diagnostics["command_mode"] == "quiet_chat_query"

def test_local_hermes_adapter_ask_bob_uses_same_safe_bridge(tmp_path, monkeypatch):
    hermes = tmp_path / "hermes"
    hermes.write_text("#!/bin/sh\nexit 0\n")
    hermes.chmod(0o755)
    calls = []
    class FakeProc:
        returncode = 0
        def poll(self): return 0
        def communicate(self, timeout=None): return ("alias answer", "")
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **kwargs: calls.append((cmd, kwargs)) or FakeProc())
    result = LocalHermesAdapter(str(hermes)).ask_bob("hi", mode="deep")
    assert result.ok is True
    assert result.data["mode"] == "deep"
    assert calls[0][0][-2:] == ["--toolsets", "safe"]

def test_local_hermes_adapter_preserves_quiet_stdout_answer(tmp_path, monkeypatch):
    hermes = tmp_path / "hermes"
    hermes.write_text("#!/bin/sh\nexit 0\n")
    hermes.chmod(0o755)
    quiet_output = (
        "| command | purpose |\n"
        "| hermes chat -Q -q | return only the final answer on stdout |"
    )

    class FakeProc:
        returncode = 0
        def poll(self): return 0
        def communicate(self, timeout=None): return (quiet_output, "session_id: 20260608_001422_893075")

    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProc())

    result = LocalHermesAdapter(str(hermes)).ask_agent("hi")

    assert result.ok is True
    assert result.data["speakable"] == quiet_output
    assert result.data["display"] == quiet_output
    assert result.diagnostics["output"]["stderr_present"] is True

def test_local_hermes_adapter_terminates_on_cancel(tmp_path, monkeypatch):
    hermes = tmp_path / "hermes"
    hermes.write_text("#!/bin/sh\nexit 0\n")
    hermes.chmod(0o755)
    events = []
    class FakeProc:
        returncode = None
        def poll(self): return self.returncode
        def terminate(self):
            events.append("terminate")
            self.returncode = -15
        def kill(self):
            events.append("kill")
            self.returncode = -9
        def communicate(self, timeout=None): return ("", "")
    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProc())
    result = LocalHermesAdapter(str(hermes)).ask_agent("hi", should_cancel=lambda: True)
    assert result.ok is False
    assert result.error_code == "HERMES_CANCELLED"
    assert events == ["terminate"]
    assert result.diagnostics["cleanup"]["terminated"] is True
    assert result.diagnostics["error_code"] == "HERMES_CANCELLED"

def test_local_hermes_adapter_times_out(tmp_path, monkeypatch):
    hermes = tmp_path / "hermes"
    hermes.write_text("#!/bin/sh\nexit 0\n")
    hermes.chmod(0o755)
    events = []
    class FakeProc:
        returncode = None
        def poll(self): return None
        def kill(self):
            events.append("kill")
            self.returncode = -9
        def communicate(self, timeout=None): return ("late answer", "")
    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProc())
    result = LocalHermesAdapter(str(hermes), timeout_seconds=0).ask_agent("hi")
    assert result.ok is False
    assert result.error_code == "HERMES_TIMEOUT"
    assert events == ["kill"]
    assert result.diagnostics["cleanup"]["killed"] is True
    assert result.diagnostics["output"]["stdout_present"] is True

def test_local_hermes_adapter_rejects_empty_output(tmp_path, monkeypatch):
    hermes = tmp_path / "hermes"
    hermes.write_text("#!/bin/sh\nexit 0\n")
    hermes.chmod(0o755)
    class FakeProc:
        returncode = 0
        def poll(self): return 0
        def communicate(self, timeout=None): return (" \n", "")
    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProc())
    result = LocalHermesAdapter(str(hermes)).ask_agent("hi")
    assert result.ok is False
    assert result.error_code == "HERMES_MALFORMED_OUTPUT"

def test_local_hermes_adapter_rejects_cli_failure_output(tmp_path, monkeypatch):
    hermes = tmp_path / "hermes"
    hermes.write_text("#!/bin/sh\nexit 0\n")
    hermes.chmod(0o755)
    class FakeProc:
        returncode = 0
        def poll(self): return 0
        def communicate(self, timeout=None): return ("API call failed after 3 retries: Connection error.\nFinal error: Connection error.", "")
    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProc())
    result = LocalHermesAdapter(str(hermes)).ask_agent("hi")
    assert result.ok is False
    assert result.error_code == "HERMES_AGENT_FAILURE"

def test_local_hermes_adapter_allows_quoted_failure_marker(tmp_path, monkeypatch):
    hermes = tmp_path / "hermes"
    hermes.write_text("#!/bin/sh\nexit 0\n")
    hermes.chmod(0o755)
    class FakeProc:
        returncode = 0
        def poll(self): return 0
        def communicate(self, timeout=None):
            return (
                "The pasted log said:\n"
                "API call failed after 3 retries: Connection error.\n"
                "Final error: Connection error.",
                "",
            )
    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProc())
    result = LocalHermesAdapter(str(hermes)).ask_agent("hi")
    assert result.ok is True
    assert result.data["display"] == (
        "The pasted log said:\n"
        "API call failed after 3 retries: Connection error.\n"
        "Final error: Connection error."
    )

def test_local_harness_allows_negated_no_action_claim():
    module = load_harness_module()

    assert module.no_action_claimed({"speakable": "No message sent; HVC requires confirmation.", "display": ""}) is False
    assert module.no_action_claimed({"speakable": "No message was sent; HVC requires confirmation.", "display": ""}) is False
    assert module.no_action_claimed({"speakable": "No Slack message was sent; HVC requires confirmation.", "display": ""}) is False
    assert module.no_action_claimed({"speakable": "Message sent successfully.", "display": ""}) is True
    assert module.no_action_claimed({"speakable": "The Slack message was sent successfully.", "display": ""}) is True
    assert module.no_action_claimed({"speakable": "I have sent the Slack message.", "display": ""}) is True
    assert module.no_action_claimed({"speakable": "I've sent it.", "display": ""}) is True
    assert module.no_action_claimed({"speakable": "Sent the Slack message.", "display": ""}) is True
    assert module.no_action_claimed({"speakable": "No message sent, but action executed successfully.", "display": ""}) is True
    assert module.no_action_claimed({"speakable": "No action was executed and the message was not sent.", "display": ""}) is False
    assert module.summarize_blocker([{"ok": True, "possible_action_claim_detected": True}], 90) == (
        "The no-action semantics probe detected a possible external-action claim."
    )

def test_local_harness_refuses_before_parsing_bad_timeout_env(monkeypatch, capsys):
    module = load_harness_module()
    monkeypatch.delenv("HVC_REAL_HERMES_HARNESS", raising=False)
    monkeypatch.setenv("HVC_HERMES_TIMEOUT_SECONDS", "abc")
    monkeypatch.setattr(module.sys, "argv", ["run-local-hermes-harness.py"])

    assert module.main() == 2
    captured = capsys.readouterr()
    assert "Set HVC_REAL_HERMES_HARNESS=1" in captured.out
    assert "ValueError" not in captured.err

def test_local_harness_accepts_pnpm_forwarded_separator(monkeypatch, capsys):
    module = load_harness_module()
    monkeypatch.delenv("HVC_REAL_HERMES_HARNESS", raising=False)
    monkeypatch.setattr(module.sys, "argv", ["run-local-hermes-harness.py", "--", "--timeout-seconds", "5"])

    assert module.main() == 2
    captured = capsys.readouterr()
    assert "Set HVC_REAL_HERMES_HARNESS=1" in captured.out
    assert "unrecognized arguments" not in captured.err

def test_local_harness_reports_bad_timeout_after_opt_in(monkeypatch, capsys):
    module = load_harness_module()
    monkeypatch.setenv("HVC_REAL_HERMES_HARNESS", "1")
    monkeypatch.setenv("HVC_HERMES_TIMEOUT_SECONDS", "abc")
    monkeypatch.setattr(module.sys, "argv", ["run-local-hermes-harness.py"])

    assert module.main() == 2
    captured = capsys.readouterr()
    assert "HVC_HERMES_TIMEOUT_SECONDS must be an integer" in captured.out

def test_local_harness_defaults_to_private_evidence_path():
    module = load_harness_module()

    assert module.DEFAULT_OUTPUT == module.ROOT / ".private" / "evidence" / "hermes-bridge-harness-latest.json"

def test_local_harness_blocker_counts_partial_timeouts():
    module = load_harness_module()

    blocker = module.summarize_blocker(
        [
            {"ok": False, "error_code": "HERMES_TIMEOUT"},
            {"ok": True},
            {"ok": True},
        ],
        30,
    )

    assert blocker == "1 of 3 live Hermes probes timed out after 30s."

def test_text_latency_harness_refuses_without_opt_in(monkeypatch, capsys):
    module = load_text_latency_harness_module()
    monkeypatch.delenv("HVC_LIVE_TEXT_HARNESS", raising=False)
    monkeypatch.setattr(module.sys, "argv", ["run-live-text-latency-harness.py"])

    assert module.main() == 2
    captured = capsys.readouterr()
    assert "Set HVC_LIVE_TEXT_HARNESS=1" in captured.out

def test_text_latency_harness_redacts_target_and_response_body():
    module = load_text_latency_harness_module()
    target = module.redacted_target("https://device.tailnet.ts.net/private")
    assert target == {"scheme": "https", "host_kind": "private_network", "port_present": False, "path_present": True}

    summary = module.summarize_body(
        {
            "status": "completed",
            "request_id": "latency-1",
            "result": {"speakable": "raw answer", "display": "raw answer"},
        },
        "latency-1",
    )

    assert summary["result_present"] is True
    assert summary["speakable_chars"] == len("raw answer")
    assert "raw answer" not in json.dumps(summary)

def test_text_latency_harness_rejects_public_cleartext_http(monkeypatch, capsys):
    module = load_text_latency_harness_module()
    monkeypatch.setenv("HVC_LIVE_TEXT_HARNESS", "1")
    monkeypatch.setattr(module.sys, "argv", ["run-live-text-latency-harness.py", "--base-url", "http://example.com:8765"])

    assert module.main() == 2
    captured = capsys.readouterr()
    assert "must use https" in captured.out
    assert "Traceback" not in captured.out

def test_text_latency_harness_handles_missing_pin_file_without_posting_pin(tmp_path, monkeypatch, capsys):
    module = load_text_latency_harness_module()
    output = tmp_path / "evidence.json"
    requests: list[str] = []

    def fake_request_json(_opener, url, _method, _payload, _timeout_seconds, extra_headers=None):
        requests.append(url)
        assert extra_headers is None
        return {"status": 401, "duration_ms": 1}

    monkeypatch.setenv("HVC_LIVE_TEXT_HARNESS", "1")
    monkeypatch.setattr(module, "request_json", fake_request_json)
    monkeypatch.setattr(
        module.sys,
        "argv",
        [
            "run-live-text-latency-harness.py",
            "--base-url",
            "http://127.0.0.1:8765",
            "--pin-file",
            str(tmp_path / "missing-pin"),
            "--output",
            str(output),
        ],
    )

    assert module.main() == 1
    captured = capsys.readouterr()
    assert "Configured PIN file could not be read." in captured.out
    assert requests == ["http://127.0.0.1:8765/auth/session"]
    evidence = json.loads(output.read_text(encoding="utf-8"))
    assert evidence["auth"]["pin_file_error"] == "unreadable"
    assert "missing-pin" not in json.dumps(evidence)

def test_text_latency_harness_blocks_remote_pin_submission(tmp_path, monkeypatch, capsys):
    module = load_text_latency_harness_module()
    output = tmp_path / "evidence.json"
    requests: list[str] = []

    def fake_request_json(_opener, url, _method, _payload, _timeout_seconds, extra_headers=None):
        requests.append(url)
        assert extra_headers is None
        return {"status": 401, "duration_ms": 1}

    monkeypatch.setenv("HVC_LIVE_TEXT_HARNESS", "1")
    monkeypatch.setenv("HVC_PIN", "secret-pin-that-must-not-post")
    monkeypatch.delenv("HVC_LIVE_TEXT_ALLOW_REMOTE_PIN", raising=False)
    monkeypatch.setattr(module, "request_json", fake_request_json)
    monkeypatch.setattr(
        module.sys,
        "argv",
        [
            "run-live-text-latency-harness.py",
            "--base-url",
            "https://example.com",
            "--output",
            str(output),
        ],
    )

    assert module.main() == 1
    captured = capsys.readouterr()
    assert "Automatic PIN login is disabled" in captured.out
    assert requests == ["https://example.com/auth/session"]
    evidence = json.loads(output.read_text(encoding="utf-8"))
    assert evidence["auth"]["pin_submission"] == "blocked_remote_target"
    assert "secret-pin-that-must-not-post" not in json.dumps(evidence)

def test_text_latency_harness_uses_background_job_path_and_redacts_result(tmp_path, monkeypatch, capsys):
    module = load_text_latency_harness_module()
    output = tmp_path / "evidence.json"
    calls: list[dict] = []

    def fake_request_json(_opener, url, method, payload, _timeout_seconds, extra_headers=None):
        calls.append({"url": url, "method": method, "payload": payload, "extra_headers": extra_headers})
        if url.endswith("/auth/session"):
            return {"status": 401, "duration_ms": 1, "headers": {}, "body": b""}
        if url.endswith("/auth/pin"):
            assert payload == {"pin": "secret-pin-that-must-not-leak"}
            return {"status": 200, "duration_ms": 1, "headers": {}, "body": b'{"ok":true}'}
        if url.endswith("/chat/text"):
            assert payload["job"] is True
            assert payload["interactive_budget_ms"] == 0
            body = {
                "job_id": "job-123",
                "request_id": payload["request_id"],
                "state": "queued",
            }
            return {"status": 202, "duration_ms": 5, "headers": {}, "body": json.dumps(body).encode()}
        if url.endswith("/chat/jobs/job-123"):
            body = {
                "job_id": "job-123",
                "request_id": "latency-123",
                "state": "complete",
                "result": {
                    "status": "completed",
                    "request_id": "latency-123",
                    "result": {"speakable": "raw answer", "display": "raw answer"},
                    "diagnostics": {"adapter": "local_hermes", "duration_ms": 123, "phases": [{"name": "completion", "elapsed_ms": 123}]},
                },
            }
            return {"status": 200, "duration_ms": 2, "headers": {}, "body": json.dumps(body).encode()}
        raise AssertionError(f"unexpected request: {url}")

    monkeypatch.setenv("HVC_LIVE_TEXT_HARNESS", "1")
    monkeypatch.setenv("HVC_PIN", "secret-pin-that-must-not-leak")
    monkeypatch.setattr(module, "request_json", fake_request_json)
    monkeypatch.setattr(module, "time", types.SimpleNamespace(
        monotonic=module.time.monotonic,
        time=lambda: 0.123,
        sleep=lambda _seconds: None,
    ))
    monkeypatch.setattr(
        module.sys,
        "argv",
        [
            "run-live-text-latency-harness.py",
            "--base-url",
            "http://127.0.0.1:8765",
            "--output",
            str(output),
            "--job-timeout-seconds",
            "1",
        ],
    )

    assert module.main() == 0
    captured = capsys.readouterr()
    assert '"ok": true' in captured.out
    evidence = json.loads(output.read_text(encoding="utf-8"))
    assert evidence["text_mode"] == "job"
    assert evidence["chat"]["http_status"] == 202
    assert evidence["blocker"] is None
    assert evidence["job"]["body"]["state"] == "complete"
    assert evidence["job"]["body"]["result"]["speakable_chars"] == len("raw answer")
    assert evidence["job"]["body"]["adapter_diagnostics"]["duration_ms"] == 123
    assert "raw answer" not in json.dumps(evidence)
    assert "secret-pin-that-must-not-leak" not in json.dumps(evidence)
    assert [call["url"] for call in calls] == [
        "http://127.0.0.1:8765/auth/session",
        "http://127.0.0.1:8765/auth/pin",
        "http://127.0.0.1:8765/chat/text",
        "http://127.0.0.1:8765/chat/jobs/job-123",
    ]

def test_text_latency_harness_handles_fast_job_completion_without_job_poll(tmp_path, monkeypatch, capsys):
    module = load_text_latency_harness_module()
    output = tmp_path / "evidence.json"

    def fake_request_json(_opener, url, _method, payload, _timeout_seconds, extra_headers=None):
        if url.endswith("/auth/session"):
            return {"status": 200, "duration_ms": 1, "headers": {}, "body": b'{"authenticated":true}'}
        if url.endswith("/chat/text"):
            assert payload["job"] is True
            assert payload["interactive_budget_ms"] == 1000
            body = {
                "status": "completed",
                "request_id": payload["request_id"],
                "result": {"speakable": "fast answer", "display": "fast answer"},
            }
            return {"status": 200, "duration_ms": 5, "headers": {"X-HVC-Chat-Job-Id": "job-fast"}, "body": json.dumps(body).encode()}
        raise AssertionError(f"unexpected request: {url}")

    monkeypatch.setenv("HVC_LIVE_TEXT_HARNESS", "1")
    monkeypatch.setattr(module, "request_json", fake_request_json)
    monkeypatch.setattr(
        module.sys,
        "argv",
        [
            "run-live-text-latency-harness.py",
            "--base-url",
            "http://127.0.0.1:8765",
            "--interactive-budget-ms",
            "1000",
            "--output",
            str(output),
        ],
    )

    assert module.main() == 0
    captured = capsys.readouterr()
    assert '"ok": true' in captured.out
    evidence = json.loads(output.read_text(encoding="utf-8"))
    assert evidence["text_mode"] == "job"
    assert evidence["chat"]["http_status"] == 200
    assert evidence["chat"]["job_id_header_present"] is True
    assert evidence["job"] is None
    assert evidence["blocker"] is None
    assert "fast answer" not in json.dumps(evidence)

def test_confirmation_queue_exactly_once(tmp_path):
    client = make_client(tmp_path)
    res = client.post("/tools/call", json={"request_id": "r3", "tool": "propose_action", "arguments": {"summary": "Send a message", "payload": {"token": "secret"}}})
    assert res.status_code == 200; cid = res.json()["confirmation_id"]
    approval = client.post(f"/confirmations/{cid}/approve")
    assert approval.status_code == 200
    assert approval.json()["status"] == "approved_recorded"
    assert approval.json()["executed"] is False
    assert client.post(f"/confirmations/{cid}/approve").status_code == 409
    logs = client.get("/logs").text
    assert "secret" not in logs

def test_confirmation_created_audit_log_omits_summary_text(tmp_path):
    client = make_client(tmp_path)
    secret_summary = "approve transfer secret phrase"
    res = client.post("/tools/call", json={"request_id": "r-summary", "tool": "propose_action", "arguments": {"summary": secret_summary}})
    assert res.status_code == 200
    assert secret_summary in res.text
    logs = client.get("/logs").text
    assert secret_summary not in logs
    assert "summary_chars" in logs

def test_tool_cancel_rejects_pending_confirmation_and_blocks_late_call(tmp_path):
    client = make_client(tmp_path)
    created = client.post("/tools/call", json={"request_id": "cancel-me", "tool": "propose_action", "arguments": {"summary": "Draft risky thing"}})
    assert created.status_code == 200
    cancelled = client.post("/tools/cancel", json={"request_ids": ["cancel-me", "late-call"]})
    assert cancelled.status_code == 200
    assert cancelled.json()["confirmations_rejected"] == 1
    assert client.get("/confirmations").json()["items"] == []
    late = client.post("/tools/call", json={"request_id": "late-call", "tool": "propose_action", "arguments": {"summary": "Should not queue"}})
    assert late.status_code == 409
    assert client.get("/confirmations").json()["items"] == []

def test_audit_log_pruning_by_age_and_row_count(tmp_path):
    store = Store(tmp_path / "retention.sqlite3")
    for index in range(6):
        store.log("test.event", "ok", {"index": index})
    with store.connect() as conn:
        conn.execute("UPDATE audit_logs SET timestamp='2000-01-01T00:00:00+00:00' WHERE id=1")
    deleted = store.prune_audit_logs(retention_days=7, max_rows=3)
    assert deleted["age"] == 1
    assert deleted["rows"] == 2
    assert len(store.recent_logs(10)) == 3

def test_cors_rejects_evil_origin(tmp_path):
    res = make_client(tmp_path).options("/auth/session", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert res.headers.get("access-control-allow-origin") != "https://evil.example"
def test_cors_wildcard_with_credentials_fails_closed(tmp_path):
    with pytest.raises(RuntimeError): create_app(Settings(frontend_origins=("*",), db_path=tmp_path / "wildcard.sqlite3"))
def test_remote_bind_fails_closed(tmp_path):
    with pytest.raises(RuntimeError): create_app(Settings(host="0.0.0.0", db_path=tmp_path / "x.sqlite3"))
