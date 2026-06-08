#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const webRoot = join(repoRoot, "apps/web");
const defaultAppUrl = "http://127.0.0.1:5173";
const configuredAppUrl = process.env.HVC_E2E_APP_URL ?? defaultAppUrl;

function spawnCommand(command, args, options = {}) {
  return spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: options.stdio ?? "inherit",
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

function currentExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return null;
}

function describeExit({ code, signal }) {
  if (code !== null) return `exit code ${code}`;
  return `signal ${signal ?? "unknown"}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canListen(host, port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, host);
  });
}

async function resolveSmokeTarget() {
  const configured = new URL(configuredAppUrl);
  const host = configured.hostname;
  const firstPort = Number(configured.port || 5173);
  if (process.env.HVC_E2E_APP_URL) {
    return {
      appUrl: configured.toString(),
      spawnServer: false,
    };
  }
  for (let port = firstPort; port < firstPort + 20; port += 1) {
    if (await canListen(host, port)) {
      const url = new URL(configured.origin);
      url.port = String(port);
      return { appUrl: url.origin, host, port, spawnServer: true };
    }
  }
  throw new Error(`No available localhost port from ${firstPort} to ${firstPort + 19}`);
}

async function assertServerStillRunning(server, url) {
  const existingExit = currentExit(server);
  if (existingExit) {
    throw new Error(`Vite exited before ${url} was ready (${describeExit(existingExit)})`);
  }
  const exit = await Promise.race([waitForExit(server), delay(250).then(() => null)]);
  if (exit) {
    throw new Error(`Vite exited before ${url} was ready (${describeExit(exit)})`);
  }
}

async function waitForApp(url, server, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server) {
      const exit = currentExit(server);
      if (exit) {
        throw new Error(`Vite exited before ${url} was ready (${describeExit(exit)})`);
      }
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        if (server) await assertServerStillRunning(server, url);
        return;
      }
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function waitForExit(child) {
  const exit = currentExit(child);
  if (exit) return Promise.resolve(exit);
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function runPlaywright(appUrl) {
  const smoke = spawnCommand(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "scripts/browser-responsive.spec.ts",
      "--reporter=list",
    ],
    { env: { HVC_E2E_APP_URL: appUrl } },
  );
  return waitForExit(smoke);
}

async function main() {
  const target = await resolveSmokeTarget();
  if (!target.spawnServer) {
    await waitForApp(target.appUrl);
    const result = await runPlaywright(target.appUrl);
    if (result.code !== 0) process.exit(result.code ?? 1);
    return;
  }

  const server = spawnCommand(
    "node",
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      target.host,
      "--port",
      String(target.port),
      "--strictPort",
    ],
    { cwd: webRoot, stdio: "pipe" },
  );
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  let exitCode = 0;
  try {
    await waitForApp(target.appUrl, server);
    const result = await runPlaywright(target.appUrl);
    if (result.code !== 0) exitCode = result.code ?? 1;
  } finally {
    server.kill("SIGINT");
    await Promise.race([
      waitForExit(server),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
