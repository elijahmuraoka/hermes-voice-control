from pathlib import Path
import sqlite3
import subprocess
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
    res = client.post("/auth/pin", json={"pin": TEST_PIN}); assert res.status_code == 200; return res.json()["session_id"]
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
def test_tool_allowlist_and_mock_agent(tmp_path):
    client = make_client(tmp_path)
    denied = client.post("/tools/call", json={"request_id": "r1", "tool": "shell", "arguments": {}}); assert denied.status_code == 403
    ok = client.post("/tools/call", json={"request_id": "r2", "tool": "ask_agent", "arguments": {"message": "hello", "mode": "quick"}})
    assert ok.status_code == 200; assert ok.json()["status"] == "completed"; assert "Mock Hermes agent heard" in ok.json()["result"]["speakable"]
    alias = client.post("/tools/call", json={"request_id": "r2-alias", "tool": "ask_bob", "arguments": {"message": "hello", "mode": "quick"}})
    assert alias.status_code == 200
def test_ask_agent_denies_action_mode(tmp_path):
    client = make_client(tmp_path)
    res = client.post("/tools/call", json={"request_id": "r-action", "tool": "ask_agent", "arguments": {"message": "send it", "mode": "action"}})
    assert res.status_code == 422

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
    assert calls[0][0][1:3] == ["chat", "-q"]
    assert "Do not take external actions" in calls[0][0][3]
    assert "mutate files" in calls[0][0][3]
    assert "send messages" in calls[0][0][3]
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
