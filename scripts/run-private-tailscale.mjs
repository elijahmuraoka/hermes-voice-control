#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = new Set(process.argv.slice(2));
const getFlagValue = (name, fallback) => {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const shouldServe = args.has("--serve");
const localOnly = args.has("--local");
const noBuild = args.has("--no-build");
const smoke = args.has("--smoke");
const backendPort = Number(
  getFlagValue("--backend-port", process.env.HVC_PORT ?? "8765"),
);
const proxyPort = Number(
  getFlagValue("--proxy-port", process.env.HVC_PROXY_PORT ?? "8787"),
);
const hostname = getFlagValue(
  "--hostname",
  process.env.HVC_TAILSCALE_HOSTNAME ?? detectTailscaleHostname(),
);

if (args.has("--help")) {
  console.log(`Usage:
  HVC_PIN_FILE=.private/hvc-pin.txt pnpm private:tailscale -- --smoke
  HVC_PIN_FILE=.private/hvc-pin.txt pnpm private:tailscale -- --local
  HVC_PIN_FILE=.private/hvc-pin.txt pnpm private:tailscale -- --serve

Options:
  --serve                 Configure Tailscale Serve to the local proxy.
  --local                 Run a long-lived localhost backend/proxy only.
  --no-build              Reuse the existing apps/web/dist build.
  --smoke                 Start, verify readiness/auth, then exit.
  --backend-port=8765     Local FastAPI port.
  --proxy-port=8787       Local one-origin proxy port.
  --hostname=name.ts.net  Tailscale HTTPS hostname for CORS/output.

Environment:
  HVC_SERVE_STATUS_SNAPSHOT  Path for the pre-change Tailscale Serve status.
`);
  process.exit(0);
}

const pin = readPin();
const tailnetOrigin = hostname ? `https://${hostname}` : undefined;
const localProxyOrigin = `http://localhost:${proxyPort}`;
const loopbackProxyOrigin = `http://127.0.0.1:${proxyPort}`;
const frontendOrigins = [
  tailnetOrigin,
  localProxyOrigin,
  loopbackProxyOrigin,
  "http://127.0.0.1:5173",
  "http://localhost:5173",
].filter(Boolean);

const backendEnv = {
  ...process.env,
  HVC_PIN: pin,
  HVC_HOST: "127.0.0.1",
  HVC_PORT: String(backendPort),
  HVC_REQUIRE_PIN: "true",
  HVC_SECURE_COOKIES: "true",
  HVC_ALLOW_LOGS_ENDPOINT: "false",
  HVC_ALLOW_REMOTE_BIND: "false",
  HVC_ALLOW_NO_PIN_REMOTE: "false",
  HVC_FRONTEND_ORIGINS: frontendOrigins.join(","),
  HVC_DB_PATH:
    process.env.HVC_DB_PATH ?? resolve(repoRoot, ".private/deployment/hvc.sqlite3"),
  HVC_GEMINI_MODE: process.env.HVC_GEMINI_MODE ?? "mock",
  HVC_HERMES_ADAPTER: process.env.HVC_HERMES_ADAPTER ?? "local",
  HVC_HERMES_BIN: process.env.HVC_HERMES_BIN ?? "hermes",
};

const proxyEnv = {
  ...process.env,
  HVC_BACKEND_ORIGIN: `http://127.0.0.1:${backendPort}`,
  HVC_PROXY_HOST: "127.0.0.1",
  HVC_PROXY_PORT: String(proxyPort),
};

const children = [];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});

async function main() {
  const selectedModes = [shouldServe, localOnly, smoke].filter(Boolean).length;
  if (selectedModes !== 1) {
    throw new Error(
      "Choose exactly one private runner mode: --smoke, --local, or --serve.",
    );
  }
  if (smoke && shouldServe) {
    throw new Error("--smoke cannot be combined with --serve; run smoke without Serve mutation, then run --serve for a long-lived deployment.");
  }
  if (noBuild && shouldServe) {
    throw new Error("--no-build cannot be combined with --serve; private Serve deployments must rebuild with a same-origin API base.");
  }
  if (backendPort === proxyPort) {
    throw new Error("Backend and proxy ports must be different.");
  }
  await assertPortAvailable("127.0.0.1", backendPort, "backend");
  await assertPortAvailable("127.0.0.1", proxyPort, "proxy");
  if (shouldServe) assertFunnelNotPublic("before configuring Tailscale Serve");
  if (!shouldServe) assertLocalPortsNotServed([backendPort, proxyPort]);
  const servePlan = shouldServe ? prepareServeChange(proxyPort, backendPort) : null;

  if (!noBuild) {
    runChecked("pnpm", ["build"], { env: { ...process.env, VITE_API_BASE: "" } });
  }

  runChecked("pnpm", ["env:check"], { env: backendEnv });

  const uvicornArgs = [
    "run",
    ...(backendEnv.HVC_GEMINI_MODE === "real" ? ["--extra", "real-gemini"] : []),
    "uvicorn",
    "app.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    String(backendPort),
  ];
  start("backend", "uv", uvicornArgs, {
    cwd: join(repoRoot, "apps/server"),
    env: backendEnv,
  });
  await waitForHttp(`http://127.0.0.1:${backendPort}/readyz`, 200);

  start("proxy", "node", ["scripts/private-one-origin-proxy.mjs"], {
    cwd: repoRoot,
    env: proxyEnv,
  });
  await waitForHttp(`http://127.0.0.1:${proxyPort}/readyz`, 200);
  await waitForHttp(`http://127.0.0.1:${proxyPort}/auth/session`, 401);
  await assertPinLoginRoundTrip(proxyPort, pin);
  if (smoke) await assertAbsoluteFormApiRequestsStayLocal(proxyPort);

  if (shouldServe) {
    let serveConfigured = false;
    try {
      runChecked("tailscale", [
        "serve",
        "--bg",
        "--https=443",
        `http://127.0.0.1:${proxyPort}`,
      ]);
      serveConfigured = true;
      assertFunnelNotPublic("after configuring Tailscale Serve", { printStatus: true });
    } catch (error) {
      if (serveConfigured) rollbackFailedServeChange(servePlan);
      throw error;
    }
  }

  const url = shouldServe ? (tailnetOrigin ?? localProxyOrigin) : localProxyOrigin;
  console.log(`Hermes Voice Control private URL: ${url}/`);
  if (shouldServe) {
    console.log(`Tailscale Serve status snapshot: ${servePlan.snapshotPath}`);
    console.log(
      servePlan.wasEmpty
        ? "Rollback Serve: tailscale serve reset"
        : "Rollback Serve: previous Serve config already pointed at this HVC proxy; no Serve rollback needed.",
    );
  } else if (localOnly) {
    console.log("Tailscale Serve not configured; local private proxy is running.");
  } else {
    console.log("Smoke completed without configuring Tailscale Serve.");
  }

  if (smoke) {
    shutdown(0);
    return;
  }
  console.log("Private runner is holding the backend and proxy open. Press Ctrl+C to stop.");
  await waitUntilStopped();
}

function readPin() {
  const explicitPin = process.env.HVC_PIN;
  if (explicitPin) return explicitPin;

  const pinFile = process.env.HVC_PIN_FILE;
  if (!pinFile) {
    throw new Error("Set HVC_PIN or HVC_PIN_FILE before private deployment.");
  }
  return readFileSync(resolve(repoRoot, pinFile), "utf8").trim();
}

function detectTailscaleHostname() {
  const status = spawnSync("tailscale", ["status", "--json"], {
    encoding: "utf8",
  });
  if (status.status !== 0 || !status.stdout) return "";
  try {
    const parsed = JSON.parse(status.stdout);
    return String(parsed?.Self?.DNSName ?? "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

function prepareServeChange(proxyPort, backendPort) {
  const desiredProxy = `http://127.0.0.1:${proxyPort}`;
  const { snapshotPath, status } = saveServeStatusSnapshot();
  const handlers = collectServeHandlers(status);
  const selectedPorts = [backendPort, proxyPort];
  const webEntries = Object.keys(status?.Web ?? {}).length;
  const tcpEntries = Object.keys(status?.TCP ?? {}).length;
  const wasEmpty = handlers.length === 0 && webEntries === 0 && tcpEntries === 0;
  const ownedHandlers = handlers.filter(isPrimaryHttpsRootHandler);
  const staleHvcReferences = [
    ...handlers
      .filter((handler) => !isPrimaryHttpsRootHandler(handler))
      .map((handler) => ({
        label: `${handler.host}${handler.path}`,
        target: handler.proxy,
      })),
    ...collectServeTcpTargets(status),
  ].filter((reference) =>
    selectedPorts.some((port) => isLocalTargetPort(reference.target, port)),
  );
  const alreadyMatched =
    ownedHandlers.length === 1 && ownedHandlers[0].proxy === desiredProxy;

  if (staleHvcReferences.length > 0) {
    const current = staleHvcReferences
      .map((reference) => `${reference.label} -> ${reference.target}`)
      .join(", ");
    throw new Error(
      `Refusing to run with stale Tailscale Serve references to selected HVC ports (${selectedPorts.join(", ")}): ${current}. Saved status snapshot to ${snapshotPath}. Remove or migrate stale HVC Serve routes explicitly before running --serve.`,
    );
  }

  if (!wasEmpty && !alreadyMatched) {
    const current = handlers.length
      ? handlers
          .map((handler) => `${handler.host}${handler.path} -> ${handler.proxy || "non-proxy handler"}`)
          .join(", ")
      : "non-empty Serve config with no web proxy handler";
    throw new Error(
      `Refusing to overwrite existing Tailscale Serve config (${current}). Saved status snapshot to ${snapshotPath}. Remove or migrate the existing Serve config explicitly before running --serve.`,
    );
  }

  console.log(`Saved previous Tailscale Serve status: ${snapshotPath}`);
  return { snapshotPath, wasEmpty, alreadyMatched };
}

function isPrimaryHttpsRootHandler(handler) {
  return handler.path === "/" && isDefaultHttpsHost(handler.host);
}

function isDefaultHttpsHost(host) {
  return !/:\d+$/.test(host) || host.endsWith(":443");
}

function assertLocalPortsNotServed(ports) {
  const status = readServeStatus({ required: false });
  if (!status) return;

  const matchingReferences = [
    ...collectServeHandlers(status).map((handler) => ({
      label: `${handler.host}${handler.path}`,
      target: handler.proxy,
    })),
    ...collectServeTcpTargets(status),
  ].filter((reference) =>
    ports.some((port) => isLocalTargetPort(reference.target, port)),
  );
  if (matchingReferences.length === 0) return;

  const current = matchingReferences
    .map((reference) => `${reference.label} -> ${reference.target}`)
    .join(", ");
  throw new Error(
    `Refusing to run a non-serve mode because Tailscale Serve already exposes one of these local ports (${ports.join(", ")}): ${current}. Run --serve to intentionally use that endpoint or choose different local ports.`,
  );
}

function rollbackFailedServeChange(servePlan) {
  if (!servePlan?.wasEmpty) return;
  const result = spawnSync("tailscale", ["serve", "reset"], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(
      "Tailscale Serve verification failed after configuration, and automatic rollback with `tailscale serve reset` also failed. Inspect `tailscale serve status --json` before retrying.",
    );
  }
}

function saveServeStatusSnapshot() {
  const snapshotPath = resolve(
    repoRoot,
    process.env.HVC_SERVE_STATUS_SNAPSHOT ??
      join(
        ".private/rehearsal",
        `tailscale-serve-status-before-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.json`,
      ),
  );
  mkdirSync(dirname(snapshotPath), { recursive: true });
  const status = readServeStatus({ required: true });
  writeFileSync(snapshotPath, JSON.stringify(status, null, 2), { mode: 0o600 });
  return { snapshotPath, status };
}

function readServeStatus({ required }) {
  const result = spawnSync("tailscale", ["serve", "status", "--json"], {
    encoding: "utf8",
  });
  if (result.error) {
    if (!required && result.error.code === "ENOENT") return null;
    throw new Error(`tailscale serve status --json failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    if (!required && /not running|not logged in|failed to connect/i.test(result.stderr)) {
      return null;
    }
    throw new Error("tailscale serve status --json failed");
  }
  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error("Could not parse Tailscale Serve status JSON");
  }
}

function collectServeHandlers(status) {
  const handlers = [];
  for (const [host, webConfig] of Object.entries(status?.Web ?? {})) {
    for (const [path, handler] of Object.entries(webConfig?.Handlers ?? {})) {
      handlers.push({
        host,
        path,
        proxy: typeof handler?.Proxy === "string" ? handler.Proxy : "",
      });
    }
  }
  return handlers;
}

function collectServeTcpTargets(status) {
  const targets = [];
  for (const [listenPort, tcpConfig] of Object.entries(status?.TCP ?? {})) {
    for (const target of collectStringValues(tcpConfig)) {
      targets.push({ label: `TCP:${listenPort}`, target });
    }
  }
  return targets;
}

function collectStringValues(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  return Object.values(value).flatMap(collectStringValues);
}

function isLocalTargetPort(target, port) {
  if (!target) return false;
  const bareMatch = target.match(/^(?:127\.0\.0\.1|localhost|\[::1\]|::1):(\d+)$/);
  if (bareMatch) return Number(bareMatch[1]) === port;
  try {
    const url = new URL(target);
    const proxyPort = Number(
      url.port || (url.protocol === "https:" ? "443" : "80"),
    );
    return (
      proxyPort === port &&
      ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function assertFunnelNotPublic(context, options = {}) {
  const statusResult = spawnSync("tailscale", ["funnel", "status", "--json"], {
    encoding: "utf8",
  });
  if (statusResult.status !== 0) {
    if (statusResult.stderr) process.stderr.write(statusResult.stderr);
    throw new Error(`tailscale funnel status --json failed ${context}; refusing to continue because public exposure cannot be ruled out.`);
  }

  let status;
  try {
    status = JSON.parse(statusResult.stdout || "{}");
  } catch {
    throw new Error(`Could not parse tailscale funnel status --json ${context}; refusing to continue because public exposure cannot be ruled out.`);
  }

  const hasFunnelConfig =
    Object.keys(status?.Web ?? {}).length > 0 ||
    Object.keys(status?.TCP ?? {}).length > 0;
  if (!hasFunnelConfig) return;

  const textResult = spawnSync("tailscale", ["funnel", "status"], {
    encoding: "utf8",
  });
  if (textResult.status !== 0) {
    if (textResult.stderr) process.stderr.write(textResult.stderr);
    throw new Error(`tailscale funnel status failed ${context}; refusing to continue because public exposure cannot be ruled out.`);
  }
  if (options.printStatus && textResult.stdout) process.stdout.write(textResult.stdout);

  const endpointLines = textResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//.test(line));

  if (endpointLines.length === 0) {
    throw new Error(`Could not confirm Funnel is tailnet-only ${context}; refusing to continue because public exposure cannot be ruled out.`);
  }

  const publicEndpoints = endpointLines.filter(
    (line) => !line.includes("(tailnet only)"),
  );
  if (publicEndpoints.length > 0) {
    throw new Error(
      `Tailscale Funnel appears public ${context}: ${publicEndpoints.join(", ")}. Disable Funnel before deploying HVC.`,
    );
  }
}

function runChecked(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed`);
  }
}

function assertPortAvailable(host, port, label) {
  return new Promise((resolveAvailable, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      const code = "code" in error ? ` (${error.code})` : "";
      reject(
        new Error(
          `${label} port ${host}:${port} is unavailable${code}; stop the existing HVC process or choose a different --${label}-port.`,
        ),
      );
    });
    server.once("listening", () => {
      server.close(() => resolveAvailable());
    });
    server.listen(port, host);
  });
}

function start(name, command, commandArgs, options) {
  const child = spawn(command, commandArgs, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`${name} exited with ${signal ?? code}`);
    shutdown(1);
  });
}

function waitUntilStopped() {
  return new Promise(() => {});
}

async function waitForHttp(url, expectedStatus) {
  const deadline = Date.now() + 15_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const status = await httpStatus(url);
      if (status === expectedStatus) return;
      lastError = `HTTP ${status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

function httpStatus(url) {
  return new Promise((resolveStatus, reject) => {
    const req = httpRequest(url, { method: "GET" }, (res) => {
      res.resume();
      res.on("end", () => resolveStatus(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.setTimeout(3_000, () => {
      req.destroy(new Error("request timed out"));
    });
    req.end();
  });
}

async function assertPinLoginRoundTrip(port, pinValue) {
  const loginBody = JSON.stringify({ pin: pinValue });
  const login = await httpJson(`http://127.0.0.1:${port}/auth/pin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(loginBody)),
      host: `localhost:${port}`,
    },
    body: loginBody,
  });
  if (login.status !== 200) {
    throw new Error(`PIN login check failed through private proxy: HTTP ${login.status}`);
  }

  const sessionCookie = extractCookie(login.headers["set-cookie"], "hvc_session");
  if (!sessionCookie) {
    throw new Error("PIN login check failed through private proxy: missing hvc_session Set-Cookie header");
  }

  const session = await httpJson(`http://127.0.0.1:${port}/auth/session`, {
    method: "GET",
    headers: { cookie: sessionCookie, host: `localhost:${port}` },
  });
  if (session.status !== 200 || session.json?.authenticated !== true) {
    throw new Error(`PIN session replay check failed through private proxy: HTTP ${session.status}`);
  }
}

function httpJson(url, options = {}) {
  return new Promise((resolveResponse, reject) => {
    const req = httpRequest(
      url,
      {
        method: options.method ?? "GET",
        headers: options.headers ?? {},
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            json = null;
          }
          resolveResponse({
            status: res.statusCode ?? 0,
            headers: res.headers,
            json,
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(3_000, () => {
      req.destroy(new Error("request timed out"));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function extractCookie(headerValue, cookieName) {
  const values = Array.isArray(headerValue)
    ? headerValue
    : headerValue
      ? [headerValue]
      : [];
  for (const value of values) {
    const cookie = value.split(";", 1)[0];
    if (cookie.startsWith(`${cookieName}=`)) return cookie;
  }
  return "";
}

async function assertAbsoluteFormApiRequestsStayLocal(port) {
  const status = await new Promise((resolveStatus, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        method: "GET",
        path: "http://example.invalid/readyz",
        headers: { host: "example.invalid" },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolveStatus(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.setTimeout(3_000, () => {
      req.destroy(new Error("absolute-form request timed out"));
    });
    req.end();
  });

  if (status !== 200) {
    throw new Error(
      `Proxy absolute-form guard failed: expected local /readyz HTTP 200, got HTTP ${status}`,
    );
  }
}

let shuttingDown = false;
function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  if (children.length === 0) process.exit(code);
  const exitTimer = setTimeout(() => process.exit(code), 500);
  if (code === 0) exitTimer.unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
