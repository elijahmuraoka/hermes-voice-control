#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const assetsDir = join(root, "apps/web/dist/assets");
const bundleBudgets = {
  // PR #76 hold-to-talk STT hardening intentionally crossed the old 250 KiB cap.
  jsBytes: 256 * 1024,
  cssBytes: 20 * 1024,
};
const diagnosticsBudgetsPath = join(
  root,
  "apps/web/src/diagnosticsBudgets.json",
);

async function assetBytes(ext) {
  const entries = await readdir(assetsDir);
  let total = 0;
  for (const entry of entries) {
    if (!entry.endsWith(ext)) continue;
    total += (await stat(join(assetsDir, entry))).size;
  }
  return total;
}

async function main() {
  const jsBytes = await assetBytes(".js");
  const cssBytes = await assetBytes(".css");
  const diagnosticsBudgets = JSON.parse(
    await readFile(diagnosticsBudgetsPath, "utf8"),
  );
  const failures = [];
  if (jsBytes > bundleBudgets.jsBytes) {
    failures.push(`JS bundle ${jsBytes} bytes exceeds ${bundleBudgets.jsBytes}`);
  }
  if (cssBytes > bundleBudgets.cssBytes) {
    failures.push(`CSS bundle ${cssBytes} bytes exceeds ${bundleBudgets.cssBytes}`);
  }
  failures.push(...validateDiagnosticsBudgets(diagnosticsBudgets));
  const result = {
    ok: failures.length === 0,
    jsBytes,
    cssBytes,
    budgets: { bundle: bundleBudgets, diagnostics: diagnosticsBudgets },
  };
  if (failures.length > 0) {
    console.error(JSON.stringify({ ...result, failures }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

function validateDiagnosticsBudgets(budgets) {
  const failures = [];
  const required = [
    "firstAudioLatencyMs",
    "toolResponseLatencyMs",
    "reconnectResumeLatencyMs",
    "smokeFlakeRate",
  ];
  for (const key of required) {
    if (typeof budgets[key] !== "number" || !Number.isFinite(budgets[key])) {
      failures.push(`Diagnostics budget ${key} must be a finite number`);
    }
  }
  if (budgets.firstAudioLatencyMs > 3000) {
    failures.push("First-audio launch budget must stay at or below 3000ms");
  }
  if (budgets.toolResponseLatencyMs > 5000) {
    failures.push("Tool response launch budget must stay at or below 5000ms");
  }
  if (budgets.reconnectResumeLatencyMs > budgets.firstAudioLatencyMs) {
    failures.push("Reconnect/resume budget must not exceed first-audio budget");
  }
  if (budgets.smokeFlakeRate > 0.02) {
    failures.push("Browser smoke flake budget must stay at or below 2%");
  }
  return failures;
}
