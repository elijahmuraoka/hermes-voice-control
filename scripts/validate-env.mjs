#!/usr/bin/env node
import { accessSync, constants, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const weakPins = new Set([
  "000000",
  "00000000",
  "11111111",
  "12345678",
  "87654321",
  "password",
  "password1",
  "qwertyui",
  "change-me",
  "changeme",
]);

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isWeakPin(value) {
  const stripped = value.trim();
  if (value !== stripped || stripped.length < 8) return true;
  if (weakPins.has(stripped.toLowerCase())) return true;
  if (new Set(stripped).size === 1) return true;
  if (/^\d+$/.test(stripped)) {
    const ascending = "01234567890123456789";
    const descending = "98765432109876543210";
    if (ascending.includes(stripped) || descending.includes(stripped)) {
      return true;
    }
  }
  return false;
}

function commandExists(command) {
  if (command.includes("/")) {
    try {
      if (!statSync(command).isFile()) return false;
      accessSync(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

function intEnv(name, fallback, { min, max } = {}) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  if (!/^-?\d+$/.test(value)) {
    errors.push(`${name} must be an integer.`);
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    errors.push(`${name} must be a safe integer.`);
    return fallback;
  }
  if (min !== undefined && parsed < min) {
    errors.push(`${name} must be at least ${min}.`);
  }
  if (max !== undefined && parsed > max) {
    errors.push(`${name} must be at most ${max}.`);
  }
  return parsed;
}

const errors = [];
const warnings = [];
const host = process.env.HVC_HOST ?? "127.0.0.1";
const port = intEnv("HVC_PORT", 8765, { min: 1, max: 65535 });
const geminiMode = process.env.HVC_GEMINI_MODE ?? "mock";
const geminiVoiceName = process.env.HVC_GEMINI_VOICE_NAME ?? "Charon";
const sttProvider =
  process.env.HVC_STT_PROVIDER ??
  (geminiMode === "real" && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
    ? "gemini"
    : "browser");
const hermesAdapter = process.env.HVC_HERMES_ADAPTER ?? "mock";
const agentName = process.env.HVC_AGENT_NAME ?? process.env.VITE_HVC_AGENT_NAME ?? "Hermes Agent";
const requirePin = boolEnv("HVC_REQUIRE_PIN", false);
const allowRemoteBind = boolEnv("HVC_ALLOW_REMOTE_BIND", false);
const allowNoPinRemote = boolEnv("HVC_ALLOW_NO_PIN_REMOTE", false);
const allowLogs = boolEnv("HVC_ALLOW_LOGS_ENDPOINT", false);
const secureCookies = boolEnv("HVC_SECURE_COOKIES", false);
const sessionTtlSeconds = intEnv("HVC_SESSION_TTL_SECONDS", 86_400, { min: 1 });
const auditLogRetentionDays = intEnv("HVC_AUDIT_LOG_RETENTION_DAYS", 30, { min: 0 });
const auditLogMaxRows = intEnv("HVC_AUDIT_LOG_MAX_ROWS", 5_000, { min: 0 });
const frontendOrigins = (process.env.HVC_FRONTEND_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const hermesTimeoutSeconds = intEnv("HVC_HERMES_TIMEOUT_SECONDS", 90, { min: 1, max: 600 });
const hermesApiUrl = process.env.HVC_HERMES_API_URL ?? "ws://127.0.0.1:9119/api/ws";
const hermesApiTokenConfigured = Boolean(process.env.HVC_HERMES_API_TOKEN || process.env.HERMES_DASHBOARD_SESSION_TOKEN);

if (!["mock", "real"].includes(geminiMode)) {
  errors.push("HVC_GEMINI_MODE must be mock or real.");
}

if (!["gemini", "browser"].includes(sttProvider)) {
  errors.push("HVC_STT_PROVIDER must be gemini or browser.");
}

if (!/^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(geminiVoiceName)) {
  errors.push("HVC_GEMINI_VOICE_NAME must be a Gemini prebuilt voice name.");
}

if (!["mock", "local", "api"].includes(hermesAdapter)) {
  errors.push("HVC_HERMES_ADAPTER must be mock, local, or api.");
}

if (!localHosts.has(host) && !allowRemoteBind) {
  errors.push("Non-local HVC_HOST requires HVC_ALLOW_REMOTE_BIND=true.");
}

if (!localHosts.has(host) && !requirePin && !allowNoPinRemote) {
  errors.push("Remote/private-network access requires HVC_REQUIRE_PIN=true.");
}

if (allowNoPinRemote) {
  errors.push("HVC_ALLOW_NO_PIN_REMOTE=true is a diagnostic override and is not allowed by pnpm env:check.");
}

if (frontendOrigins.includes("*")) {
  errors.push("HVC_FRONTEND_ORIGINS must not include wildcard '*' while credentials are enabled.");
}

if (requirePin && isWeakPin(process.env.HVC_PIN ?? "000000")) {
  errors.push("HVC_REQUIRE_PIN=true requires a non-default, non-placeholder PIN of at least 8 characters.");
}

if (requirePin && !secureCookies) {
  warnings.push("Set HVC_SECURE_COOKIES=true when serving over HTTPS/private reverse proxy.");
}

if (allowLogs) {
  warnings.push("HVC_ALLOW_LOGS_ENDPOINT=true exposes redacted audit logs; use only for trusted debugging sessions.");
}

if (geminiMode === "real" && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
  errors.push("HVC_GEMINI_MODE=real requires GEMINI_API_KEY or GOOGLE_API_KEY.");
}

if (hermesAdapter === "local" && !commandExists(process.env.HVC_HERMES_BIN ?? "hermes")) {
  errors.push("HVC_HERMES_ADAPTER=local requires HVC_HERMES_BIN to resolve to an executable.");
}

if (hermesAdapter === "api") {
  if (!hermesApiTokenConfigured) {
    errors.push("HVC_HERMES_ADAPTER=api requires HVC_HERMES_API_TOKEN or HERMES_DASHBOARD_SESSION_TOKEN.");
  }
  try {
    const parsedHermesApiUrl = new URL(hermesApiUrl);
    if (parsedHermesApiUrl.protocol !== "ws:" || !localHosts.has(parsedHermesApiUrl.hostname)) {
      errors.push("HVC_HERMES_API_URL must be a loopback ws:// URL.");
    }
  } catch {
    errors.push("HVC_HERMES_API_URL must be a valid loopback ws:// URL.");
  }
}

const result = {
  ok: errors.length === 0,
  mode: {
    host,
    port,
    geminiMode,
    geminiVoiceName,
    sttProvider,
    hermesAdapter,
    hermesApiUrl: hermesAdapter === "api" ? hermesApiUrl : undefined,
    hermesApiTokenConfigured: hermesAdapter === "api" ? hermesApiTokenConfigured : undefined,
    agentName,
    hermesTimeoutSeconds,
    requirePin,
    sessionTtlSeconds,
    auditLogRetentionDays,
    auditLogMaxRows,
  },
  warnings,
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (errors.length > 0) process.exit(1);
