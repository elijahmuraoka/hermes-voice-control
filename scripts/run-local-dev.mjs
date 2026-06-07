#!/usr/bin/env node
import { spawn } from "node:child_process";

const repoRoot = new URL("..", import.meta.url).pathname;
const children = [];

function start(name, command, args, cwd = repoRoot) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env },
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`${name} exited with ${signal ?? code}`);
    shutdown(code ?? 1);
  });
}

let shuttingDown = false;
function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) child.kill("SIGINT");
  setTimeout(() => process.exit(code), 500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("server", "pnpm", ["dev:server"]);
start("web", "pnpm", ["dev:web"]);
