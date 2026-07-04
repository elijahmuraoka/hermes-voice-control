import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "validate-env.mjs");

function runEnv(extraEnv = {}) {
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      ...extraEnv,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    body: JSON.parse(result.stdout),
  };
}

test("env check accepts api Hermes adapter with loopback URL and configured token", () => {
  const result = runEnv({
    HVC_HERMES_ADAPTER: "api",
    HVC_HERMES_API_URL: "ws://127.0.0.1:9119/api/ws",
    HVC_HERMES_API_TOKEN: "configured-test-token",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.mode.hermesAdapter, "api");
  assert.equal(result.body.mode.hermesApiUrl, "ws://127.0.0.1:9119/api/ws");
  assert.equal(result.body.mode.hermesApiTokenConfigured, true);
  assert.doesNotMatch(result.stdout, /configured-test-token/);
});

test("env check accepts api Hermes adapter token from Hermes dashboard env", () => {
  const result = runEnv({
    HVC_HERMES_ADAPTER: "api",
    HERMES_DASHBOARD_SESSION_TOKEN: "dashboard-test-token",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.mode.hermesApiTokenConfigured, true);
  assert.doesNotMatch(result.stdout, /dashboard-test-token/);
});

test("env check rejects api Hermes adapter without token", () => {
  const result = runEnv({
    HVC_HERMES_ADAPTER: "api",
  });

  assert.equal(result.status, 1);
  assert.equal(result.body.ok, false);
  assert.match(result.body.errors.join("\n"), /HVC_HERMES_ADAPTER=api requires/);
});

test("env check rejects non-loopback api Hermes URLs", () => {
  const result = runEnv({
    HVC_HERMES_ADAPTER: "api",
    HVC_HERMES_API_TOKEN: "configured-test-token",
    HVC_HERMES_API_URL: "ws://100.96.34.85:9119/api/ws",
  });

  assert.equal(result.status, 1);
  assert.equal(result.body.ok, false);
  assert.match(result.body.errors.join("\n"), /HVC_HERMES_API_URL/);
});
