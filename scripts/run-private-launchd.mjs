#!/usr/bin/env node
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (args.includes("--help")) {
  console.log(`Usage:
  node scripts/run-private-launchd.mjs -- --env-file .private/deployment/launchd.env

Loads an ignored env file, then runs:
  pnpm private:tailscale -- --serve

The env file is parsed as KEY=VALUE lines only. Shell expansion is not
performed. Keep it chmod 600 because it normally contains Gemini credentials
or a path to the private PIN file.`);
  process.exit(0);
}

const envFile = resolve(repoRoot, getFlagValue("--env-file", ".private/deployment/launchd.env"));
const envFromFile = loadEnvFile(envFile);
const childEnv = {
  ...process.env,
  ...envFromFile,
  PATH:
    envFromFile.PATH ||
    process.env.PATH ||
    "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
};
const pnpmBin = childEnv.HVC_PNPM_BIN || "pnpm";

if (!childEnv.HVC_PIN && !childEnv.HVC_PIN_FILE) {
  throw new Error(
    `Launchd env file ${envFile} must set HVC_PIN_FILE or HVC_PIN.`,
  );
}
if (!childEnv.HVC_PIN && childEnv.HVC_PIN_FILE) {
  assertPrivatePinFile(childEnv.HVC_PIN_FILE);
}

const child = spawn(pnpmBin, ["private:tailscale", "--", "--serve"], {
  cwd: repoRoot,
  env: childEnv,
  stdio: "inherit",
});

let shuttingDown = false;

child.on("exit", (code, signal) => {
  if (shuttingDown) process.exit(0);
  if (signal) {
    console.error(`HVC private runner exited from signal ${signal}`);
    process.exit(1);
  }
  if (code === 0) {
    console.error("HVC private runner exited unexpectedly with code 0");
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`Failed to start HVC private runner: ${error.message}`);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shuttingDown = true;
    if (!child.killed) child.kill("SIGTERM");
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}

function getFlagValue(name, fallback) {
  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1]) return args[index + 1];
  const prefix = `${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function loadEnvFile(filePath) {
  const stat = statSync(filePath);
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(
      `Refusing to read ${filePath}; run chmod 600 because launchd env files can contain secrets.`,
    );
  }

  const env = {};
  const contents = readFileSync(filePath, "utf8");
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = line.startsWith("export ") ? line.slice(7).trim() : line;
    const match = assignment.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      throw new Error(`Invalid env line ${index + 1} in ${filePath}`);
    }
    env[match[1]] = unquote(match[2].trim());
  }
  return env;
}

function assertPrivatePinFile(pinFile) {
  const pinPath = resolve(repoRoot, pinFile);
  if (!existsSync(pinPath)) {
    throw new Error(`HVC_PIN_FILE does not exist: ${pinPath}`);
  }
  const stat = statSync(pinPath);
  if (!stat.isFile()) {
    throw new Error(`Expected HVC_PIN_FILE to be a file: ${pinPath}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`Run chmod 600 ${pinPath} before starting launchd.`);
  }
  if ((stat.mode & 0o400) === 0) {
    throw new Error(`PIN file owner must be able to read ${pinPath}.`);
  }
  accessSync(pinPath, constants.R_OK);
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
