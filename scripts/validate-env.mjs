#!/usr/bin/env node
import { existsSync } from "node:fs";
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
  if (command.includes("/") && existsSync(command)) return true;
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

const errors = [];
const warnings = [];
const host = process.env.HVC_HOST ?? "127.0.0.1";
const geminiMode = process.env.HVC_GEMINI_MODE ?? "mock";
const hermesAdapter = process.env.HVC_HERMES_ADAPTER ?? "mock";
const requirePin = boolEnv("HVC_REQUIRE_PIN", false);
const allowRemoteBind = boolEnv("HVC_ALLOW_REMOTE_BIND", false);
const allowNoPinRemote = boolEnv("HVC_ALLOW_NO_PIN_REMOTE", false);
const allowLogs = boolEnv("HVC_ALLOW_LOGS_ENDPOINT", false);
const secureCookies = boolEnv("HVC_SECURE_COOKIES", false);

if (!["mock", "real"].includes(geminiMode)) {
  errors.push("HVC_GEMINI_MODE must be mock or real.");
}

if (!["mock", "local"].includes(hermesAdapter)) {
  errors.push("HVC_HERMES_ADAPTER must be mock or local.");
}

if (!localHosts.has(host) && !allowRemoteBind) {
  errors.push("Non-local HVC_HOST requires HVC_ALLOW_REMOTE_BIND=true.");
}

if (!localHosts.has(host) && !requirePin && !allowNoPinRemote) {
  errors.push("Remote/private-network access requires HVC_REQUIRE_PIN=true.");
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

const result = {
  ok: errors.length === 0,
  mode: { host, geminiMode, hermesAdapter, requirePin },
  warnings,
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (errors.length > 0) process.exit(1);
