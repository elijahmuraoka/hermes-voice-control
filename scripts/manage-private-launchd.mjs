#!/usr/bin/env node
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const command = getCommand(args) ?? "help";
const privateRoot = resolve(repoRoot, ".private");
const label = getFlagValue("--label", "io.github.elijahmuraoka.hermes-voice-control");
const domain = getFlagValue("--domain", "daemon");
if (!["daemon", "agent"].includes(domain)) {
  throw new Error("--domain must be daemon or agent.");
}
const domainKind = domain === "daemon" ? "launchdaemon" : "launchagent";
const serviceUser = getFlagValue(
  "--user",
  process.env.SUDO_USER && process.env.SUDO_USER !== "root"
    ? process.env.SUDO_USER
    : process.env.USER ?? "",
);
const envFile = resolve(repoRoot, getFlagValue("--env-file", ".private/deployment/launchd.env"));
const logDir = resolve(repoRoot, getFlagValue("--log-dir", ".private/deployment/logs"));
const localPlist = resolve(
  repoRoot,
  getFlagValue("--plist", `.private/deployment/${label}.${domainKind}.plist`),
);
const installedPlist =
  domain === "daemon"
    ? getFlagValue("--install-plist", `/Library/LaunchDaemons/${label}.plist`)
    : resolve(homedir(), getFlagValue("--install-plist", `Library/LaunchAgents/${label}.plist`));
const nodePath = getFlagValue("--node", findCommand("node") || process.execPath);
const pnpmPath = getFlagValue("--pnpm", findCommand("pnpm") || "pnpm");

if (command === "help" || args.includes("--help")) {
  printHelp();
  process.exit(command === "help" ? 0 : 0);
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function run() {
  switch (command) {
    case "render":
      renderCommand();
      break;
    case "install":
      installCommand();
      break;
    case "uninstall":
      uninstallCommand();
      break;
    case "status":
      launchctl(["print", serviceTarget()]);
      break;
    case "bootstrap":
      launchctl(["bootstrap", bootstrapTarget(), installedPlist], {
        requiresInstallPermission: true,
      });
      break;
    case "kickstart":
      launchctl(["kickstart", "-k", serviceTarget()], {
        requiresInstallPermission: true,
      });
      break;
    case "bootout":
      launchctl(["bootout", serviceTarget()], {
        requiresInstallPermission: true,
      });
      break;
    case "check-env":
      assertPrivateEnvFile();
      console.log(`Launchd env file is readable and private: ${envFile}`);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(2);
  }
}

function printHelp() {
  console.log(`Usage:
  pnpm private:launchd -- render [--domain=daemon|agent]
  pnpm private:launchd -- install [--domain=daemon|agent]
  pnpm private:launchd -- check-env
  pnpm private:launchd -- status [--domain=daemon|agent]
  pnpm private:launchd -- bootstrap [--domain=daemon|agent]
  pnpm private:launchd -- kickstart [--domain=daemon|agent]
  pnpm private:launchd -- bootout [--domain=daemon|agent]
  pnpm private:launchd -- uninstall [--domain=daemon|agent]
  node scripts/manage-private-launchd.mjs render --print [--domain=daemon|agent]

Defaults:
  label:        ${label}
  domain:       ${domain}
  user:         ${serviceUser || "(unset)"}
  env file:     ${envFile}
  local plist:  ${localPlist}
  install path: ${installedPlist}
  logs:         ${logDir}

The plist contains paths only. Put secrets in the ignored env file and keep it
chmod 600. The default domain is a LaunchDaemon so the service can survive
logout and headless reboot. Use --domain=agent only for auto-login or
GUI-session scoped operation. The install command copies the already-rendered
local plist; run render, inspect the file, then install. Use the direct node
command for --print so stdout stays valid plist XML. This script does not enable
Tailscale Funnel.`);
}

function renderCommand() {
  const plist = renderPlist();
  if (args.includes("--print")) {
    process.stdout.write(plist);
    return;
  }
  assertPrivatePath(dirname(localPlist), "local plist directory");
  assertPrivatePath(logDir, "log directory");
  ensurePrivateDir(dirname(localPlist));
  ensurePrivateDir(logDir);
  writeFileSync(localPlist, plist, { mode: 0o600 });
  chmodSync(localPlist, 0o600);
  console.log(`Wrote ${domain === "daemon" ? "LaunchDaemon" : "LaunchAgent"} plist: ${localPlist}`);
}

function installCommand() {
  const plist = assertReviewedPlistFile();
  const referencedPaths = plistRuntimePaths(plist);
  assertPrivateEnvFile(referencedPaths.envFile);
  assertRuntimeDirsReady([
    privateRoot,
    dirname(localPlist),
    ...referencedPaths.logDirs,
  ]);
  ensureInstallAllowed("install");
  mkdirSync(dirname(installedPlist), { recursive: true });
  copyFileSync(localPlist, installedPlist);
  chmodSync(installedPlist, 0o644);
  if (domain === "daemon") {
    const chown = spawnSync("chown", ["root:wheel", installedPlist], {
      stdio: "inherit",
    });
    if (chown.status !== 0) throw new Error("chown root:wheel failed");
  }
  const baseCommand = domain === "daemon" ? ["sudo", "pnpm"] : ["pnpm"];
  const targetFlags = [`--domain=${domain}`, `--label=${label}`];
  const bootstrapCommand = formatShellCommand([
    ...baseCommand,
    "private:launchd",
    "--",
    "bootstrap",
    ...targetFlags,
    `--install-plist=${installedPlist}`,
  ]);
  const kickstartCommand = formatShellCommand([
    ...baseCommand,
    "private:launchd",
    "--",
    "kickstart",
    ...targetFlags,
  ]);
  console.log(`Installed ${domain === "daemon" ? "LaunchDaemon" : "LaunchAgent"} plist: ${installedPlist}`);
  console.log(`Next approved steps: ${bootstrapCommand} && ${kickstartCommand}`);
}

function uninstallCommand() {
  ensureInstallAllowed("uninstall");
  rmSync(installedPlist, { force: true });
  console.log(`Removed ${domain === "daemon" ? "LaunchDaemon" : "LaunchAgent"} plist if present: ${installedPlist}`);
}

function renderPlist() {
  if (domain === "daemon" && !serviceUser) {
    throw new Error("LaunchDaemon rendering requires --user or a USER/SUDO_USER environment value.");
  }
  const wrapper = join(repoRoot, "scripts/run-private-launchd.mjs");
  const stdoutPath = join(logDir, "hvc-private-runner.out.log");
  const stderrPath = join(logDir, "hvc-private-runner.err.log");
  const path = getFlagValue("--path", buildDefaultPath());
  const userBlock =
    domain === "daemon"
      ? `  <key>UserName</key>
  <string>${xml(serviceUser)}</string>
`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
${userBlock}  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(wrapper)}</string>
    <string>--</string>
    <string>--env-file</string>
    <string>${xml(envFile)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(path)}</string>
    <key>HVC_PNPM_BIN</key>
    <string>${xml(pnpmPath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrPath)}</string>
</dict>
</plist>
`;
}

function assertPrivateEnvFile(filePath = envFile) {
  assertPrivatePath(filePath, "launchd env file");
  if (!existsSync(filePath)) {
    throw new Error(
      `Create ${filePath} with HVC_PIN_FILE/HVC_GEMINI_MODE settings before installing launchd.`,
    );
  }
  const stat = statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Expected launchd env path to be a file: ${filePath}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`Run chmod 600 ${filePath} before installing launchd.`);
  }
  if ((stat.mode & 0o400) === 0) {
    throw new Error(`Env file owner must be able to read ${filePath}.`);
  }
  if (domain === "daemon" && serviceUser) {
    const expectedUid = uidForUser(serviceUser);
    if (stat.uid !== expectedUid) {
      throw new Error(`Run chown ${serviceUser} ${filePath} before installing launchd.`);
    }
  } else {
    accessSync(filePath, constants.R_OK);
  }
  const env = loadEnvFile(filePath);
  if (!env.HVC_PIN && !env.HVC_PIN_FILE) {
    throw new Error(`Launchd env file ${filePath} must set HVC_PIN_FILE or HVC_PIN.`);
  }
  if (!env.HVC_PIN && env.HVC_PIN_FILE) {
    assertPrivatePinFile(env.HVC_PIN_FILE);
  }
}

function assertPrivatePinFile(pinFile) {
  const pinPath = resolve(repoRoot, pinFile);
  assertPrivatePath(pinPath, "HVC_PIN_FILE");
  if (!existsSync(pinPath)) {
    throw new Error(`HVC_PIN_FILE does not exist: ${pinPath}`);
  }
  const stat = statSync(pinPath);
  if (!stat.isFile()) {
    throw new Error(`Expected HVC_PIN_FILE to be a file: ${pinPath}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`Run chmod 600 ${pinPath} before installing launchd.`);
  }
  if ((stat.mode & 0o400) === 0) {
    throw new Error(`PIN file owner must be able to read ${pinPath}.`);
  }
  if (domain === "daemon" && serviceUser) {
    const expectedUid = uidForUser(serviceUser);
    if (stat.uid !== expectedUid) {
      throw new Error(`Run chown ${serviceUser} ${pinPath} before installing launchd.`);
    }
  } else {
    accessSync(pinPath, constants.R_OK);
  }
}

function assertReviewedPlistFile() {
  if (!existsSync(localPlist)) {
    throw new Error(`Render and review ${localPlist} before installing launchd.`);
  }
  const stat = statSync(localPlist);
  if (!stat.isFile()) {
    throw new Error(`Expected reviewed plist to be a file: ${localPlist}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`Run chmod 600 ${localPlist} before installing launchd.`);
  }
  const plist = readFileSync(localPlist, "utf8");
  const plistLabel = plistStringForKey(plist, "Label");
  if (plistLabel !== label) {
    throw new Error(`Render ${localPlist} for label ${label} before installing.`);
  }
  const workingDirectory = plistStringForKey(plist, "WorkingDirectory");
  if (!workingDirectory) {
    throw new Error(`Render ${localPlist} with a WorkingDirectory before installing.`);
  }
  const plistWorkingDirectory = resolve(repoRoot, workingDirectory);
  if (plistWorkingDirectory !== repoRoot) {
    throw new Error(`Render ${localPlist} for working directory ${repoRoot} before installing.`);
  }
  const userKey = "<key>UserName</key>";
  if (domain === "daemon") {
    if (!plist.includes(userKey) || !plist.includes(`<string>${xml(serviceUser)}</string>`)) {
      throw new Error(
        `Render ${localPlist} as a LaunchDaemon for ${serviceUser} before installing.`,
      );
    }
  } else if (plist.includes(userKey)) {
    throw new Error(`Render ${localPlist} as a LaunchAgent before installing.`);
  }
  return plist;
}

function plistRuntimePaths(plist) {
  const programArguments = plistStringArrayForKey(plist, "ProgramArguments");
  const envFlagIndex = programArguments.indexOf("--env-file");
  if (envFlagIndex === -1 || !programArguments[envFlagIndex + 1]) {
    throw new Error(`Render ${localPlist} with a launchd env file before installing.`);
  }
  const envPath = resolve(repoRoot, programArguments[envFlagIndex + 1]);
  const rawStdoutPath = plistStringForKey(plist, "StandardOutPath");
  const rawStderrPath = plistStringForKey(plist, "StandardErrorPath");
  if (!rawStdoutPath || !rawStderrPath) {
    throw new Error(`Render ${localPlist} with StandardOutPath and StandardErrorPath before installing.`);
  }
  const stdoutPath = resolve(repoRoot, rawStdoutPath);
  const stderrPath = resolve(repoRoot, rawStderrPath);
  const logDirs = [...new Set([dirname(stdoutPath), dirname(stderrPath)])];
  return { envFile: envPath, logDirs };
}

function plistStringForKey(plist, key) {
  const match = plist.match(
    new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<string>([\\s\\S]*?)</string>`),
  );
  if (!match) return "";
  return xmlUnescape(match[1]);
}

function plistStringArrayForKey(plist, key) {
  const match = plist.match(
    new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<array>([\\s\\S]*?)</array>`),
  );
  if (!match) return [];
  return [...match[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((item) =>
    xmlUnescape(item[1]),
  );
}

function assertRuntimeDirsReady(paths = [privateRoot, dirname(localPlist), logDir]) {
  for (const path of paths) {
    assertPrivatePath(path, "runtime directory");
    assertPrivateDirReady(path);
  }
}

function assertPrivateDirReady(path) {
  if (!existsSync(path)) {
    throw new Error(`Run pnpm private:launchd -- render before install; missing ${path}.`);
  }
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    throw new Error(`Expected private runtime path to be a directory: ${path}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`Run chmod 700 ${path} before installing launchd.`);
  }
  if (domain === "daemon" && serviceUser) {
    const expectedUid = uidForUser(serviceUser);
    if (stat.uid !== expectedUid) {
      throw new Error(
        `Run pnpm private:launchd -- render as ${serviceUser} before install; ${path} is not owned by that user.`,
      );
    }
  }
}

function ensurePrivateDir(path) {
  assertPrivatePath(path, "private runtime directory");
  mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  chmodSync(privateRoot, 0o700);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function assertPrivatePath(path, labelText) {
  if (path !== privateRoot && !path.startsWith(`${privateRoot}/`)) {
    throw new Error(
      `${labelText} must stay under ${privateRoot}; refusing to chmod or trust ${path}.`,
    );
  }
}

function ensureInstallAllowed(action) {
  if (domain === "daemon" && typeof process.getuid === "function" && process.getuid() !== 0) {
    throw new Error(
      `LaunchDaemon ${action} writes ${installedPlist}; rerun with sudo after reviewing ${localPlist}.`,
    );
  }
}

function getFlagValue(name, fallback) {
  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1]) return args[index + 1];
  const prefix = `${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function getCommand(rawArgs) {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--") continue;
    if (!arg.startsWith("--")) return arg;
    if (!arg.includes("=") && rawArgs[index + 1] && !rawArgs[index + 1].startsWith("--")) {
      index += 1;
    }
  }
  return undefined;
}

function loadEnvFile(filePath) {
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

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function formatShellCommand(commandParts) {
  return commandParts.map(shellArg).join(" ");
}

function shellArg(value) {
  const raw = String(value);
  return /^[A-Za-z0-9_./:=+-]+$/.test(raw)
    ? raw
    : `'${raw.replace(/'/g, `'\\''`)}'`;
}

function findCommand(commandName) {
  const result = spawnSync("which", [commandName], { encoding: "utf8" });
  const resolved = result.status === 0 ? result.stdout.trim() : "";
  return resolved || undefined;
}

function launchctl(commandArgs, options = {}) {
  if (options.requiresInstallPermission) {
    ensureInstallAllowed(commandArgs[0] ?? "launchctl");
  }
  const result = spawnSync("launchctl", commandArgs, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

function serviceTarget() {
  return domain === "daemon" ? `system/${label}` : `gui/${uid()}/${label}`;
}

function bootstrapTarget() {
  return domain === "daemon" ? "system" : `gui/${uid()}`;
}

function uid() {
  if (typeof process.getuid === "function") return process.getuid();
  const result = spawnSync("id", ["-u"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Could not determine user id");
  return result.stdout.trim();
}

function uidForUser(user) {
  const result = spawnSync("id", ["-u", user], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Could not determine uid for ${user}`);
  return Number(result.stdout.trim());
}

function xml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlUnescape(value) {
  return String(value)
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildDefaultPath() {
  const commandDirs = [
    nodePath,
    pnpmPath,
    findCommand("uv"),
    findCommand("tailscale"),
    findCommand("hermes"),
  ]
    .filter(Boolean)
    .map((commandPath) => (commandPath.includes("/") ? dirname(commandPath) : ""))
    .filter(Boolean);
  return [
    ...new Set([
      ...commandDirs,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ]),
  ].join(":");
}
