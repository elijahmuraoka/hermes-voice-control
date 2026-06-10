import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privateRoot = join(repoRoot, ".private");
const managerScript = join(repoRoot, "scripts/manage-private-launchd.mjs");
const runnerScript = join(repoRoot, "scripts/run-private-launchd.mjs");

test("manager direct print emits clean plist XML", () => {
  const result = runNode(managerScript, ["render", "--domain=agent", "--print"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^<\?xml version="1\.0"/);
  assert.doesNotMatch(result.stdout, /hermes-voice-control@/);
  assert.doesNotMatch(result.stdout, /private:launchd/);
});

test("manager render keeps plist private and resets existing file mode", () => {
  const tempDir = makePrivateTempDir();
  try {
    const plistPath = join(tempDir, "hvc.test.plist");
    const logDir = join(tempDir, "logs");
    writeFileSync(plistPath, "");
    chmodSync(plistPath, 0o644);

    const result = runNode(managerScript, [
      "render",
      "--domain=agent",
      "--plist",
      plistPath,
      "--log-dir",
      logDir,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(statSync(plistPath).mode & 0o077, 0);
    assert.equal(statSync(logDir).mode & 0o077, 0);
    assert.match(readFileSync(plistPath, "utf8"), /<key>RunAtLoad<\/key>/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("manager rejects runtime paths outside the private tree", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "hvc-launchd-public-"));
  try {
    const result = runNode(managerScript, [
      "render",
      "--domain=agent",
      "--plist",
      join(tempDir, "hvc.plist"),
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must stay under .*\.private/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("manager check-env validates required private PIN file", () => {
  const tempDir = makePrivateTempDir();
  try {
    const envFile = join(tempDir, "launchd.env");
    const missingPin = join(tempDir, "missing-pin.txt");
    writePrivateFile(envFile, `HVC_PIN_FILE=${missingPin}\n`);

    const missing = runNode(managerScript, [
      "check-env",
      "--domain=agent",
      "--env-file",
      envFile,
    ]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /HVC_PIN_FILE does not exist/);

    const pinFile = join(tempDir, "pin.txt");
    writeFileSync(pinFile, "supersecretpin\n");
    chmodSync(pinFile, 0o644);
    writePrivateFile(envFile, `HVC_PIN_FILE=${pinFile}\n`);

    const permissive = runNode(managerScript, [
      "check-env",
      "--domain=agent",
      "--env-file",
      envFile,
    ]);
    assert.notEqual(permissive.status, 0);
    assert.match(permissive.stderr, /Run chmod 600/);

    chmodSync(pinFile, 0o600);
    const valid = runNode(managerScript, [
      "check-env",
      "--domain=agent",
      "--env-file",
      envFile,
    ]);
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /Launchd env file is readable and private/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("manager install validates paths referenced by reviewed plist", () => {
  const tempDir = makePrivateTempDir();
  try {
    const plistPath = join(tempDir, "hvc.reviewed.plist");
    const installedPlist = join(tempDir, "installed.plist");
    const renderedEnvFile = join(tempDir, "rendered.env");
    const installEnvFile = join(tempDir, "install.env");
    const pinFile = join(tempDir, "pin.txt");
    const renderedLogDir = join(tempDir, "rendered-logs");
    const installLogDir = join(tempDir, "install-logs");

    writePrivateFile(pinFile, "supersecretpin\n");
    writePrivateFile(installEnvFile, `HVC_PIN_FILE=${pinFile}\n`);

    const render = runNode(managerScript, [
      "render",
      "--domain=agent",
      "--plist",
      plistPath,
      "--env-file",
      renderedEnvFile,
      "--log-dir",
      renderedLogDir,
    ]);
    assert.equal(render.status, 0, render.stderr);

    const install = runNode(managerScript, [
      "install",
      "--domain=agent",
      "--plist",
      plistPath,
      "--env-file",
      installEnvFile,
      "--log-dir",
      installLogDir,
      "--install-plist",
      installedPlist,
    ]);

    assert.notEqual(install.status, 0);
    assert.match(install.stderr, new RegExp(`Create ${escapeRegExp(renderedEnvFile)}`));
    assert.equal(existsSync(installedPlist), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runner validates PIN file before spawning private runner", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "hvc-launchd-runner-"));
  try {
    const envFile = join(tempDir, "launchd.env");
    const markerFile = join(tempDir, "spawned.txt");
    const fakePnpm = join(tempDir, "fake-pnpm.sh");
    writeFileSync(
      fakePnpm,
      `#!/bin/sh\necho fake pnpm "$@"\ntouch "${markerFile}"\nexit 42\n`,
    );
    chmodSync(fakePnpm, 0o700);

    const missingPin = join(tempDir, "missing-pin.txt");
    writePrivateFile(envFile, `HVC_PIN_FILE=${missingPin}\nHVC_PNPM_BIN=${fakePnpm}\n`);
    const missing = runNode(runnerScript, ["--env-file", envFile]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /HVC_PIN_FILE does not exist/);
    assert.equal(existsSync(markerFile), false);

    const pinFile = join(tempDir, "pin.txt");
    writeFileSync(pinFile, "supersecretpin\n");
    chmodSync(pinFile, 0o644);
    writePrivateFile(envFile, `HVC_PIN_FILE=${pinFile}\nHVC_PNPM_BIN=${fakePnpm}\n`);
    const permissive = runNode(runnerScript, ["--env-file", envFile]);
    assert.notEqual(permissive.status, 0);
    assert.match(permissive.stderr, /Run chmod 600/);
    assert.equal(existsSync(markerFile), false);

    chmodSync(pinFile, 0o600);
    const valid = runNode(runnerScript, ["--env-file", envFile]);
    assert.equal(valid.status, 42);
    assert.match(valid.stdout, /fake pnpm private:tailscale -- --serve/);
    assert.equal(existsSync(markerFile), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function runNode(script, args) {
  const { HVC_PIN, HVC_PIN_FILE, ...cleanEnv } = process.env;
  return spawnSync(process.execPath, [script, "--", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...cleanEnv,
      PATH: process.env.PATH ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    },
  });
}

function makePrivateTempDir() {
  mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  chmodSync(privateRoot, 0o700);
  const tempDir = mkdtempSync(join(privateRoot, "test-launchd-"));
  chmodSync(tempDir, 0o700);
  return tempDir;
}

function writePrivateFile(path, contents) {
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
