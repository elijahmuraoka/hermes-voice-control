import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const scriptPath = resolve(repoRoot, "scripts/run-live-text-latency-harness.py");

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
