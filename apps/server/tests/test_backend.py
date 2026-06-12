from pathlib import Path
import importlib.util
import sys
import sqlite3
import subprocess
import types
import pytest
from fastapi.testclient import TestClient
from app import gemini as gemini_module
from app.adapters import LocalHermesAdapter
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

def load_harness_module():
    repo_root = Path(__file__).resolve().parents[3]
    harness_path = repo_root / "scripts" / "run-local-hermes-harness.py"
    spec = importlib.util.spec_from_file_location("hvc_harness", harness_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
def test_health_has_no_secrets(tmp_path):
    res = make_client(tmp_path).get("/healthz"); assert res.status_code == 200; assert res.json() == {"ok": True}
def test_readyz_reports_safe_runtime_posture(tmp_path):
    res = make_client(tmp_path).get("/readyz")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["gemini_mode"] == "mock"
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
    token = gemini_module.RealGeminiTokenBroker().create_token()
    assert token.token == "ephemeral-token-name"
    assert token.mode == "real"
    assert token.model == "gemini-test-model"
    assert created["api_key"] == "super-secret-gemini-key"
    assert created["http_options"] == {"api_version": "v1alpha"}
    assert created["config"]["uses"] == 1
    assert created["config"]["live_connect_constraints"] == {
        "model": "gemini-test-model",
        "config": {"response_modalities": ["AUDIO"]},
    }
    assert "super-secret-gemini-key" not in str(created["config"])

def test_tool_allowlist_and_mock_agent(tmp_path):
    client = make_client(tmp_path)
    denied = client.post("/tools/call", json={"request_id": "r1", "tool": "shell", "arguments": {}}); assert denied.status_code == 403
    ok = client.post("/tools/call", json={"request_id": "r2", "tool": "ask_agent", "arguments": {"message": "hello", "mode": "quick"}})
    assert ok.status_code == 200; assert ok.json()["status"] == "completed"; assert "Mock Bob heard" in ok.json()["result"]["speakable"]
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
    assert "Mock Bob heard" not in logs
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
    assert "You are Bob" in calls[0][0][4]
    assert "If asked who you are, say you are Bob" in calls[0][0][4]
    assert "Do not take external actions" in calls[0][0][4]
    assert "mutate files" in calls[0][0][4]
    assert "send messages" in calls[0][0][4]
    assert calls[0][1]["shell"] is False
    assert calls[0][0][-2:] == ["--toolsets", "safe"]

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
