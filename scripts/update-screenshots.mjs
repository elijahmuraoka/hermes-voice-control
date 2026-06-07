#!/usr/bin/env node
import { spawn } from "node:child_process";

const repoRoot = new URL("..", import.meta.url).pathname;
const child = spawn("node", ["scripts/run-browser-smoke.mjs"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, HVC_E2E_WRITE_SCREENSHOTS: "true" },
});

child.on("exit", (code) => process.exit(code ?? 1));
