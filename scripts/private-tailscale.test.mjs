import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerScript = join(repoRoot, "scripts/run-private-tailscale.mjs");

test("serve mode accepts an existing HVC 443 handler alongside unrelated Serve handlers", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "hvc-private-tailscale-"));
  const backendPort = await getAvailablePort();
  const proxyPort = await getAvailablePort();
  const fakeBin = join(tempDir, "bin");
  const markerFile = join(tempDir, "serve-configured.txt");
  const pinFile = join(tempDir, "pin.txt");

  try {
    writeFileSync(pinFile, "supersecretpin\n", { mode: 0o600 });
    writeExecutable(
      join(fakeBin, "pnpm"),
      `#!/usr/bin/env node
process.exit(0);
`,
    );
    writeExecutable(
      join(fakeBin, "tailscale"),
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const mixedServeStatus = {
  Web: {
    "bobs-mac-mini.tail764d71.ts.net:3000": {
      Handlers: { "/": { Proxy: "http://127.0.0.1:3001" } },
    },
    "bobs-mac-mini.tail764d71.ts.net:443": {
      Handlers: { "/": { Proxy: "http://127.0.0.1:${proxyPort}" } },
    },
  },
  TCP: {},
};

if (args.join(" ") === "status --json") {
  console.log(JSON.stringify({
    Self: { DNSName: "bobs-mac-mini.tail764d71.ts.net." },
  }));
  process.exit(0);
}
if (args.join(" ") === "serve status --json") {
  console.log(JSON.stringify(mixedServeStatus));
  process.exit(0);
}
if (args.join(" ") === "funnel status --json") {
  console.log(JSON.stringify({}));
  process.exit(0);
}
if (args[0] === "serve" && args.includes("--bg") && args.includes("--https=443")) {
  writeFileSync(${JSON.stringify(markerFile)}, args.join(" "));
  process.exit(0);
}
console.error("unexpected tailscale args: " + args.join(" "));
process.exit(1);
`,
    );
    writeExecutable(
      join(fakeBin, "uv"),
      `#!/usr/bin/env node
import { createServer } from "node:http";

const port = Number(process.env.HVC_PORT);
const server = createServer((req, res) => {
  if (req.url === "/readyz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === "/auth/session" && !String(req.headers.cookie ?? "").includes("hvc_session=ok")) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: "Authentication required" }));
    return;
  }
  if (req.url === "/auth/session") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ authenticated: true }));
    return;
  }
  if (req.url === "/auth/pin" && req.method === "POST") {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "hvc_session=ok; HttpOnly; Secure; SameSite=Lax",
      });
      res.end(JSON.stringify({ authenticated: true }));
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ detail: "not found" }));
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
    );

    const child = spawn(
      process.execPath,
      [
        runnerScript,
        "--serve",
        `--backend-port=${backendPort}`,
        `--proxy-port=${proxyPort}`,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HVC_PIN_FILE: pinFile,
          HVC_SERVE_STATUS_SNAPSHOT: join(tempDir, "serve-status-before.json"),
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const output = await waitForRunner(child, markerFile);
    assert.match(output.stdout, /Hermes Voice Control private URL:/);
    assert.doesNotMatch(output.stderr, /Refusing to overwrite existing Tailscale Serve config/);
    assert.match(readFileSync(markerFile, "utf8"), /--https=443/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("serve mode rejects stale non-primary handlers targeting selected HVC ports", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "hvc-private-tailscale-stale-"));
  const backendPort = await getAvailablePort();
  const proxyPort = await getAvailablePort();
  const fakeBin = join(tempDir, "bin");
  const pinFile = join(tempDir, "pin.txt");

  try {
    writeFileSync(pinFile, "supersecretpin\n", { mode: 0o600 });
    writeExecutable(
      join(fakeBin, "tailscale"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const staleServeStatus = {
  Web: {
    "bobs-mac-mini.tail764d71.ts.net:3000": {
      Handlers: { "/": { Proxy: "http://127.0.0.1:${proxyPort}" } },
    },
    "bobs-mac-mini.tail764d71.ts.net:443": {
      Handlers: { "/": { Proxy: "http://127.0.0.1:${proxyPort}" } },
    },
  },
  TCP: {},
};

if (args.join(" ") === "status --json") {
  console.log(JSON.stringify({
    Self: { DNSName: "bobs-mac-mini.tail764d71.ts.net." },
  }));
  process.exit(0);
}
if (args.join(" ") === "serve status --json") {
  console.log(JSON.stringify(staleServeStatus));
  process.exit(0);
}
if (args.join(" ") === "funnel status --json") {
  console.log(JSON.stringify({}));
  process.exit(0);
}
console.error("unexpected tailscale args: " + args.join(" "));
process.exit(1);
`,
    );

    const result = spawnSync(
      process.execPath,
      [
        runnerScript,
        "--serve",
        `--backend-port=${backendPort}`,
        `--proxy-port=${proxyPort}`,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          HVC_PIN_FILE: pinFile,
          HVC_SERVE_STATUS_SNAPSHOT: join(tempDir, "serve-status-before.json"),
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /stale Tailscale Serve references/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function writeExecutable(path, contents) {
  const directory = dirname(path);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  writeFileSync(path, contents, { mode: 0o700 });
  chmodSync(path, 0o700);
}

async function waitForRunner(child, markerFile) {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    await waitUntil(() => existsSync(markerFile), 15_000, () => stderr || stdout);
    await waitUntil(
      () => stdout.includes("Hermes Voice Control private URL:"),
      15_000,
      () => stderr || stdout,
    );
    return { stdout, stderr };
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
}

async function waitUntil(predicate, timeoutMs, describeFailure) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Timed out waiting for runner: ${describeFailure()}`);
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("No port assigned"));
      });
    });
    server.listen(0, "127.0.0.1");
  });
}
