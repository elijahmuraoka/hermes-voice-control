#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const webRoot = join(repoRoot, "apps/web");
const appUrl = process.env.HVC_E2E_APP_URL ?? "http://127.0.0.1:5173";

function spawnCommand(command, args, options = {}) {
  return spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: options.stdio ?? "inherit",
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

async function waitForApp(url, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function main() {
  const server = spawnCommand(
    "node",
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
    { cwd: webRoot, stdio: "pipe" },
  );
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  try {
    await waitForApp(appUrl);
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
    const result = await waitForExit(smoke);
    if (result.code !== 0) process.exit(result.code ?? 1);
  } finally {
    server.kill("SIGINT");
    await Promise.race([
      waitForExit(server),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
