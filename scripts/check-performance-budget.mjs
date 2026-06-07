#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const assetsDir = join(root, "apps/web/dist/assets");
const budgets = {
  jsBytes: 250 * 1024,
  cssBytes: 20 * 1024,
};

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
  const failures = [];
  if (jsBytes > budgets.jsBytes) {
    failures.push(`JS bundle ${jsBytes} bytes exceeds ${budgets.jsBytes}`);
  }
  if (cssBytes > budgets.cssBytes) {
    failures.push(`CSS bundle ${cssBytes} bytes exceeds ${budgets.cssBytes}`);
  }
  const result = { ok: failures.length === 0, jsBytes, cssBytes, budgets };
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
