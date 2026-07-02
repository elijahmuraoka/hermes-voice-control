import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const scriptPath = resolve(repoRoot, "scripts/run-live-text-latency-harness.py");

function runPythonSnippet(source, env = {}) {
  return spawnSync("python3", ["-c", source], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("latency harness rejects malformed timeout config without a traceback", () => {
  const result = spawnSync("python3", [scriptPath], {
    cwd: repoRoot,
    env: { ...process.env, HVC_LIVE_TEXT_TIMEOUT_SECONDS: "abc" },
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /"ok": false/);
  assert.match(result.stdout, /client-timeout-seconds/);
  assert.doesNotMatch(result.stdout, /Traceback/);
});

test("latency harness rejects malformed interactive budget without a traceback", () => {
  const result = spawnSync("python3", [scriptPath], {
    cwd: repoRoot,
    env: { ...process.env, HVC_LIVE_TEXT_INTERACTIVE_BUDGET_MS: "abc" },
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /"ok": false/);
  assert.match(result.stdout, /interactive-budget-ms/);
  assert.doesNotMatch(result.stdout, /Traceback/);
});

test("latency harness reports malformed job timeout flags by option name", () => {
  const timeoutResult = spawnSync("python3", [scriptPath], {
    cwd: repoRoot,
    env: { ...process.env, HVC_LIVE_TEXT_JOB_TIMEOUT_SECONDS: "abc" },
    encoding: "utf8",
  });
  assert.equal(timeoutResult.status, 2);
  assert.equal(timeoutResult.stderr, "");
  assert.match(timeoutResult.stdout, /"ok": false/);
  assert.match(timeoutResult.stdout, /job-timeout-seconds/);
  assert.doesNotMatch(timeoutResult.stdout, /client-timeout-seconds/);
  assert.doesNotMatch(timeoutResult.stdout, /Traceback/);

  const pollResult = spawnSync("python3", [scriptPath], {
    cwd: repoRoot,
    env: { ...process.env, HVC_LIVE_TEXT_JOB_POLL_INTERVAL_SECONDS: "abc" },
    encoding: "utf8",
  });
  assert.equal(pollResult.status, 2);
  assert.equal(pollResult.stderr, "");
  assert.match(pollResult.stdout, /"ok": false/);
  assert.match(pollResult.stdout, /job-poll-interval-seconds/);
  assert.doesNotMatch(pollResult.stdout, /client-timeout-seconds/);
  assert.doesNotMatch(pollResult.stdout, /Traceback/);
});

test("latency harness sync mode ignores malformed job-only configuration", () => {
  const result = runPythonSnippet(`
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_text_latency_harness", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

chat_payloads = []

def fake_request_json(_opener, url, _method, payload, _timeout_seconds, extra_headers=None):
    if url.endswith("/auth/session"):
        return {"status": 200, "duration_ms": 0, "headers": {}, "body": b"{}"}
    if url.endswith("/chat/text"):
        chat_payloads.append(payload)
        return {
            "status": 200,
            "duration_ms": 0,
            "headers": {},
            "body": json.dumps({
                "status": "completed",
                "request_id": payload["request_id"],
                "result": {"speakable": "sync answer", "display": "sync answer"},
            }).encode(),
        }
    raise AssertionError(f"unexpected request: {url}")

output = Path(tempfile.mkdtemp()) / "evidence.json"
os.environ["HVC_LIVE_TEXT_HARNESS"] = "1"
os.environ["HVC_LIVE_TEXT_JOB_TIMEOUT_SECONDS"] = "not-a-timeout"
os.environ["HVC_LIVE_TEXT_JOB_POLL_INTERVAL_SECONDS"] = "not-an-interval"
os.environ["HVC_LIVE_TEXT_INTERACTIVE_BUDGET_MS"] = "not-a-budget"
module.request_json = fake_request_json
sys.argv = [
    "run-live-text-latency-harness.py",
    "--sync",
    "--base-url",
    "http://127.0.0.1:8765",
    "--output",
    str(output),
]

exit_code = module.main()
evidence = json.loads(output.read_text(encoding="utf-8"))
print(json.dumps({
    "exit_code": exit_code,
    "ok": evidence["ok"],
    "text_mode": evidence["text_mode"],
    "job_timeout_seconds": evidence["job_timeout_seconds"],
    "job_poll_interval_seconds": evidence["job_poll_interval_seconds"],
    "chat_payload_has_job": "job" in chat_payloads[0],
}))
`);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const finalLine = result.stdout
    .trim()
    .split("\n")
    .findLast((line) => line.startsWith("{") && line.endsWith("}"));
  assert.ok(finalLine, result.stdout);
  assert.deepEqual(JSON.parse(finalLine), {
    exit_code: 0,
    ok: true,
    text_mode: "sync",
    job_timeout_seconds: null,
    job_poll_interval_seconds: null,
    chat_payload_has_job: false,
  });
});

test("latency harness does not legacy-cancel timed out job creation without a job id", () => {
  const result = runPythonSnippet(`
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_text_latency_harness", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

calls = []

def fake_request_json(_opener, url, _method, payload, _timeout_seconds, extra_headers=None):
    calls.append(url)
    if url.endswith("/auth/session"):
        return {"status": 200, "duration_ms": 0, "headers": {}, "body": b"{}"}
    if url.endswith("/chat/text"):
        return {"status": None, "duration_ms": 15000, "timed_out": True, "headers": {}, "body": b""}
    raise AssertionError(f"unexpected request: {url}")

output = Path(tempfile.mkdtemp()) / "evidence.json"
os.environ["HVC_LIVE_TEXT_HARNESS"] = "1"
module.request_json = fake_request_json
sys.argv = [
    "run-live-text-latency-harness.py",
    "--base-url",
    "http://127.0.0.1:8765",
    "--output",
    str(output),
]

exit_code = module.main()
evidence = json.loads(output.read_text(encoding="utf-8"))
print(json.dumps({
    "exit_code": exit_code,
    "ok": evidence["ok"],
    "blocker": evidence["blocker"],
    "cancellation": evidence["cancellation"],
    "cancel_called": any("/cancel" in url or url.endswith("/tools/cancel") for url in calls),
}))
`);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const finalLine = result.stdout
    .trim()
    .split("\n")
    .findLast((line) => line.startsWith("{") && line.endsWith("}"));
  assert.ok(finalLine, result.stdout);
  assert.deepEqual(JSON.parse(finalLine), {
    exit_code: 1,
    ok: false,
    blocker: "The /chat/text request exceeded the client timeout.",
    cancellation: {
      kind: "chat_job",
      status: "not_attempted",
      reason: "job_id_unavailable_after_create_timeout",
    },
    cancel_called: false,
  });
});

test("latency harness rejects legacy sync responses in default job mode", () => {
  const result = runPythonSnippet(`
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_text_latency_harness", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fake_request_json(_opener, url, _method, payload, _timeout_seconds, extra_headers=None):
    if url.endswith("/auth/session"):
        return {"status": 200, "duration_ms": 0, "headers": {}, "body": b"{}"}
    if url.endswith("/chat/text"):
        assert payload["job"] is True
        return {
            "status": 200,
            "duration_ms": 0,
            "headers": {},
            "body": json.dumps({
                "status": "completed",
                "request_id": payload["request_id"],
                "result": {"speakable": "legacy answer", "display": "legacy answer"},
            }).encode(),
        }
    raise AssertionError(f"unexpected request: {url}")

output = Path(tempfile.mkdtemp()) / "evidence.json"
os.environ["HVC_LIVE_TEXT_HARNESS"] = "1"
module.request_json = fake_request_json
sys.argv = [
    "run-live-text-latency-harness.py",
    "--base-url",
    "http://127.0.0.1:8765",
    "--output",
    str(output),
]

exit_code = module.main()
evidence = json.loads(output.read_text(encoding="utf-8"))
print(json.dumps({
    "exit_code": exit_code,
    "ok": evidence["ok"],
    "blocker": evidence["blocker"],
    "job_id_header_present": evidence["chat"]["job_id_header_present"],
}))
`);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const finalLine = result.stdout
    .trim()
    .split("\n")
    .findLast((line) => line.startsWith("{") && line.endsWith("}"));
  assert.ok(finalLine, result.stdout);
  assert.deepEqual(JSON.parse(finalLine), {
    exit_code: 1,
    ok: false,
    blocker: "The /chat/text response did not include chat job evidence.",
    job_id_header_present: false,
  });
});

test("latency harness reports malformed completed background jobs as blockers", () => {
  const result = runPythonSnippet(`
import importlib.util
import json

spec = importlib.util.spec_from_file_location("live_text_latency_harness", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

evidence = {
    "ok": False,
    "text_mode": "job",
    "chat": {"http_status": 202},
    "job": {
        "job_id_present": True,
        "body": {
            "state": "complete",
            "request_id_matches": True,
            "result_present": False,
        },
    },
}
print(json.dumps({"blocker": module.blocker_for(evidence)}))
`);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    blocker: "The completed background text job did not include a result.",
  });
});

test("latency harness times out instead of accepting jobs at the deadline", () => {
  const result = runPythonSnippet(`
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_text_latency_harness", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FakeTime:
    now = 0.0

    @classmethod
    def monotonic(cls):
        return cls.now

    @classmethod
    def time(cls):
        return 1.0

    @classmethod
    def sleep(cls, seconds):
        cls.now += seconds

calls = []

def fake_request_json(_opener, url, _method, payload, timeout_seconds, extra_headers=None):
    calls.append({"url": url, "timeout_seconds": timeout_seconds})
    if url.endswith("/auth/session"):
        return {"status": 200, "duration_ms": 0, "headers": {}, "body": b"{}"}
    if url.endswith("/chat/text"):
        return {
            "status": 202,
            "duration_ms": 0,
            "headers": {},
            "body": json.dumps({
                "job_id": "job-at-deadline",
                "request_id": payload["request_id"],
                "state": "queued",
            }).encode(),
        }
    if url.endswith("/chat/jobs/job-at-deadline/cancel"):
        return {
            "status": 200,
            "duration_ms": 0,
            "headers": {},
            "body": json.dumps({"job_id": "job-at-deadline", "state": "cancelled"}).encode(),
        }
    if url.endswith("/chat/jobs/job-at-deadline"):
        state = "complete" if FakeTime.now >= 1.0 else "queued"
        body = {
            "job_id": "job-at-deadline",
            "request_id": "latency-1000",
            "state": state,
        }
        if state == "complete":
            body["result"] = {
                "status": "completed",
                "request_id": "latency-1000",
                "result": {"speakable": "late answer", "display": "late answer"},
            }
        return {"status": 200, "duration_ms": 0, "headers": {}, "body": json.dumps(body).encode()}
    raise AssertionError(f"unexpected request: {url}")

output = Path(tempfile.mkdtemp()) / "evidence.json"
os.environ["HVC_LIVE_TEXT_HARNESS"] = "1"
module.time = FakeTime
module.request_json = fake_request_json
sys.argv = [
    "run-live-text-latency-harness.py",
    "--base-url",
    "http://127.0.0.1:8765",
    "--output",
    str(output),
    "--job-timeout-seconds",
    "1",
    "--job-poll-interval-seconds",
    "1",
]

exit_code = module.main()
evidence = json.loads(output.read_text(encoding="utf-8"))
print(json.dumps({
    "exit_code": exit_code,
    "ok": evidence["ok"],
    "blocker": evidence["blocker"],
    "job_timed_out": evidence["job"]["timed_out"],
    "poll_count": len(evidence["job"]["polls"]),
    "cancellation_kind": evidence["cancellation"]["kind"],
    "called_complete_poll": any(call["url"].endswith("/chat/jobs/job-at-deadline") and FakeTime.now >= 1.0 for call in calls[3:]),
}))
`);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const finalLine = result.stdout
    .trim()
    .split("\n")
    .findLast((line) => line.startsWith("{") && line.endsWith("}"));
  assert.ok(finalLine, result.stdout);
  assert.deepEqual(JSON.parse(finalLine), {
    exit_code: 1,
    ok: false,
    blocker: "The background text job did not finish before the job timeout.",
    job_timed_out: true,
    poll_count: 1,
    cancellation_kind: "chat_job",
    called_complete_poll: false,
  });
});

test("latency harness reports background job status poll failures", () => {
  const result = runPythonSnippet(`
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_text_latency_harness", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fake_request_json(_opener, url, _method, payload, timeout_seconds, extra_headers=None):
    if url.endswith("/auth/session"):
        return {"status": 200, "duration_ms": 0, "headers": {}, "body": b"{}"}
    if url.endswith("/chat/text"):
        return {
            "status": 202,
            "duration_ms": 0,
            "headers": {},
            "body": json.dumps({
                "job_id": "job-poll-error",
                "request_id": payload["request_id"],
                "state": "queued",
            }).encode(),
        }
    if url.endswith("/chat/jobs/job-poll-error"):
        return {
            "status": None,
            "duration_ms": 1,
            "timed_out": False,
            "error": "url_error",
            "headers": {},
            "body": b"",
        }
    raise AssertionError(f"unexpected request: {url}")

output = Path(tempfile.mkdtemp()) / "evidence.json"
os.environ["HVC_LIVE_TEXT_HARNESS"] = "1"
module.request_json = fake_request_json
sys.argv = [
    "run-live-text-latency-harness.py",
    "--base-url",
    "http://127.0.0.1:8765",
    "--output",
    str(output),
]

exit_code = module.main()
evidence = json.loads(output.read_text(encoding="utf-8"))
print(json.dumps({
    "exit_code": exit_code,
    "ok": evidence["ok"],
    "blocker": evidence["blocker"],
    "job_error": evidence["job"]["error"],
    "poll_error": evidence["job"]["polls"][0]["error"],
    "job_state": evidence["job"]["body"]["state"],
}))
`);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const finalLine = result.stdout
    .trim()
    .split("\n")
    .findLast((line) => line.startsWith("{") && line.endsWith("}"));
  assert.ok(finalLine, result.stdout);
  assert.deepEqual(JSON.parse(finalLine), {
    exit_code: 1,
    ok: false,
    blocker: "The background text job status request was not reachable.",
    job_error: "url_error",
    poll_error: "url_error",
    job_state: "queued",
  });
});

test("latency harness rejects job completions that arrive after the deadline", () => {
  const result = runPythonSnippet(`
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_text_latency_harness", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FakeTime:
    now = 0.0

    @classmethod
    def monotonic(cls):
        return cls.now

    @classmethod
    def time(cls):
        return 1.0

    @classmethod
    def sleep(cls, seconds):
        cls.now += seconds

poll_timeouts = []

def fake_request_json(_opener, url, _method, payload, timeout_seconds, extra_headers=None):
    if url.endswith("/auth/session"):
        return {"status": 200, "duration_ms": 0, "headers": {}, "body": b"{}"}
    if url.endswith("/chat/text"):
        return {
            "status": 202,
            "duration_ms": 0,
            "headers": {},
            "body": json.dumps({
                "job_id": "job-late-complete",
                "request_id": payload["request_id"],
                "state": "queued",
            }).encode(),
        }
    if url.endswith("/chat/jobs/job-late-complete/cancel"):
        return {"status": 200, "duration_ms": 0, "headers": {}, "body": b"{}"}
    if url.endswith("/chat/jobs/job-late-complete"):
        poll_timeouts.append(timeout_seconds)
        FakeTime.now += timeout_seconds
        return {
            "status": 200,
            "duration_ms": round(timeout_seconds * 1000),
            "headers": {},
            "body": json.dumps({
                "job_id": "job-late-complete",
                "request_id": "latency-1000",
                "state": "complete",
                "result": {
                    "status": "completed",
                    "request_id": "latency-1000",
                    "result": {"speakable": "late answer", "display": "late answer"},
                },
            }).encode(),
        }
    raise AssertionError(f"unexpected request: {url}")

output = Path(tempfile.mkdtemp()) / "evidence.json"
os.environ["HVC_LIVE_TEXT_HARNESS"] = "1"
module.time = FakeTime
module.request_json = fake_request_json
sys.argv = [
    "run-live-text-latency-harness.py",
    "--base-url",
    "http://127.0.0.1:8765",
    "--output",
    str(output),
    "--client-timeout-seconds",
    "1",
    "--job-timeout-seconds",
    "0.05",
    "--job-poll-interval-seconds",
    "0.01",
]

exit_code = module.main()
evidence = json.loads(output.read_text(encoding="utf-8"))
print(json.dumps({
    "exit_code": exit_code,
    "ok": evidence["ok"],
    "blocker": evidence["blocker"],
    "job_timed_out": evidence["job"]["timed_out"],
    "poll_timeout": poll_timeouts[0],
    "cancellation_kind": evidence["cancellation"]["kind"],
}))
`);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const finalLine = result.stdout
    .trim()
    .split("\n")
    .findLast((line) => line.startsWith("{") && line.endsWith("}"));
  assert.ok(finalLine, result.stdout);
  assert.deepEqual(JSON.parse(finalLine), {
    exit_code: 1,
    ok: false,
    blocker: "The background text job did not finish before the job timeout.",
    job_timed_out: true,
    poll_timeout: 0.05,
    cancellation_kind: "chat_job",
  });
});

test("latency harness does not cancel after a status poll timeout before the job deadline", () => {
  const result = runPythonSnippet(`
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_text_latency_harness", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FakeTime:
    now = 0.0

    @classmethod
    def monotonic(cls):
        return cls.now

    @classmethod
    def time(cls):
        return 1.0

    @classmethod
    def sleep(cls, seconds):
        cls.now += seconds

cancel_called = False

def fake_request_json(_opener, url, _method, payload, timeout_seconds, extra_headers=None):
    global cancel_called
    if url.endswith("/auth/session"):
        return {"status": 200, "duration_ms": 0, "headers": {}, "body": b"{}"}
    if url.endswith("/chat/text"):
        return {
            "status": 202,
            "duration_ms": 0,
            "headers": {},
            "body": json.dumps({
                "job_id": "job-poll-timeout",
                "request_id": payload["request_id"],
                "state": "thinking",
            }).encode(),
        }
    if url.endswith("/chat/jobs/job-poll-timeout/cancel"):
        cancel_called = True
        return {"status": 200, "duration_ms": 0, "headers": {}, "body": b"{}"}
    if url.endswith("/chat/jobs/job-poll-timeout"):
        FakeTime.now += timeout_seconds
        return {
            "status": None,
            "duration_ms": round(timeout_seconds * 1000),
            "timed_out": True,
            "headers": {},
            "body": b"",
        }
    raise AssertionError(f"unexpected request: {url}")

output = Path(tempfile.mkdtemp()) / "evidence.json"
os.environ["HVC_LIVE_TEXT_HARNESS"] = "1"
module.time = FakeTime
module.request_json = fake_request_json
sys.argv = [
    "run-live-text-latency-harness.py",
    "--base-url",
    "http://127.0.0.1:8765",
    "--output",
    str(output),
    "--client-timeout-seconds",
    "1",
    "--job-timeout-seconds",
    "120",
]

exit_code = module.main()
evidence = json.loads(output.read_text(encoding="utf-8"))
print(json.dumps({
    "exit_code": exit_code,
    "ok": evidence["ok"],
    "blocker": evidence["blocker"],
    "job_timed_out": evidence["job"]["timed_out"],
    "job_error": evidence["job"]["error"],
    "cancel_called": cancel_called,
    "cancellation_present": "cancellation" in evidence,
}))
`);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const finalLine = result.stdout
    .trim()
    .split("\n")
    .findLast((line) => line.startsWith("{") && line.endsWith("}"));
  assert.ok(finalLine, result.stdout);
  assert.deepEqual(JSON.parse(finalLine), {
    exit_code: 1,
    ok: false,
    blocker: "The background text job status request timed out.",
    job_timed_out: false,
    job_error: "timeout",
    cancel_called: false,
    cancellation_present: false,
  });
});

test("latency harness rejects malformed base-url ports without a traceback", () => {
  const result = spawnSync("python3", [scriptPath, "--base-url", "http://127.0.0.1:bad"], {
    cwd: repoRoot,
    env: { ...process.env, HVC_LIVE_TEXT_HARNESS: "1" },
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /"ok": false/);
  assert.match(result.stdout, /base-url/);
  assert.doesNotMatch(result.stdout, /Traceback/);
});

test("latency harness rejects malformed base-url hosts without a traceback", () => {
  const result = spawnSync("python3", [scriptPath, "--base-url", "https://exa mple.com"], {
    cwd: repoRoot,
    env: { ...process.env, HVC_LIVE_TEXT_HARNESS: "1" },
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /"ok": false/);
  assert.match(result.stdout, /malformed host/);
  assert.doesNotMatch(result.stdout, /Traceback/);
});
