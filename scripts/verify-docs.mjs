#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const failures = [];

async function exists(path) {
  try {
    await stat(join(root, path));
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  failures.push(message);
}

async function requirePath(path) {
  if (!(await exists(path))) fail(`Missing required path: ${path}`);
}

async function read(path) {
  return readFile(join(root, path), "utf8");
}

function isExternalLink(target) {
  return /^(https?:|mailto:|#)/.test(target);
}

async function verifyMarkdownLinks(path) {
  const content = await read(path);
  const links = [...content.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)];
  for (const [, rawTarget] of links) {
    const target = rawTarget.split("#", 1)[0].trim();
    if (!target || isExternalLink(target)) continue;
    const normalizedTarget = normalize(join(path, "..", target));
    if (normalizedTarget.startsWith("..")) {
      fail(`${path} links outside repo: ${rawTarget}`);
      continue;
    }
    if (!(await exists(normalizedTarget))) {
      fail(`${path} has missing link target: ${rawTarget}`);
    }
  }
}

async function listMarkdownFiles(dir) {
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listMarkdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

async function verifyActiveSpecs() {
  const activeRoot = "docs/specs/active";
  const entries = await readdir(join(root, activeRoot), { withFileTypes: true });
  const activeSpecs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const index = await read("docs/INDEX.md");
  for (const spec of activeSpecs) {
    const specPath = `${activeRoot}/${spec}/SPEC.md`;
    await requirePath(specPath);
    const content = await read(specPath);
    if (!content.startsWith("---")) fail(`${specPath} is missing frontmatter`);
    if (!content.includes("status: active")) fail(`${specPath} must have status: active`);
    if (!index.includes(`specs/active/${spec}/`)) {
      fail(`docs/INDEX.md does not list active spec ${spec}`);
    }
  }
}

async function main() {
  const required = [
    "README.md",
    "docs/INDEX.md",
    "docs/VISION.md",
    "docs/ARCHITECTURE.md",
    "docs/BACKLOG.md",
    "docs/specs/active",
    "docs/specs/archived",
    "skills/doc-maintenance/SKILL.md",
  ];
  for (const path of required) await requirePath(path);

  const readme = await read("README.md");
  if ((readme.match(/mobile-idle\.png/g) ?? []).length !== 1) {
    fail("README.md should reference mobile-idle.png exactly once");
  }
  if ((readme.match(/desktop\.png/g) ?? []).length !== 1) {
    fail("README.md should reference desktop.png exactly once");
  }
  if (/\bBob\b/.test(readme)) {
    fail("README.md should stay generic and not mention capital-B Bob");
  }

  for (const file of ["README.md", ...(await listMarkdownFiles("docs"))]) {
    await verifyMarkdownLinks(file);
  }
  await verifyActiveSpecs();

  if (failures.length > 0) {
    console.error(JSON.stringify({ ok: false, failures }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, checked: "docs" }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
