---
name: doc-maintenance
description: "Maintain this repo's docs/spec structure, living docs, and verification gates."
owner:
  - Maintainers
tags:
  - docs
  - specs
  - workflow
visibility: shared
tooling:
  - codex
  - claude
  - cursor
  - hermes
---

# Doc Maintenance

Use this skill when changing repository documentation, updating active specs, or
checking that docs still match implementation.

Local lifecycle/audit/index commands require the Tomoji CLI on `PATH`; it is
not vendored or automatically installed by this repository. The CI docs check
is deliberately repo-contained and does not need that CLI.

## What to Maintain

- `docs/VISION.md`: current product intent and non-goals.
- `docs/ARCHITECTURE.md`: current runtime path, components, and trust
  boundaries.
- `docs/INDEX.md`: map of docs and active specs.
- `docs/BACKLOG.md`: open work not yet promoted into a spec.
- `docs/specs/active/`: current implementation or verification bundles.
- `docs/specs/archived/`: shipped or superseded historical specs.

## Working Rules

- Keep living docs current when implementation, security posture, setup, or
  public-facing positioning changes.
- Put feature-specific plans, reviews, decisions, and verification notes inside
  the owning active spec bundle.
- Treat archived specs as snapshots; do not edit them in place.
- Prefer a small, current doc update over broad narrative rewrites.
- Keep public docs generic for any Hermes agent; personal agent names belong in
  local configuration examples or private notes. Exact historical PR titles
  may remain in reference ledgers without becoming product naming.
- A merged PR or archived spec is source-lifecycle evidence, not proof of live
  deployment, physical-device acceptance, or production readiness.
- Use `ghx` for GitHub and `wt` for isolated worktrees. Preserve existing dirty
  evidence and unrelated worktrees.

## Spec Lifecycle

Create bundles with the CLI rather than hand-building their structure:

```bash
tomoji docs spec-new <slug> --no-auto-pr --json
```

Keep plans, decisions, reviews, and evidence under that bundle. Once its PR
exists, set `pr: <number>` in `SPEC.md` frontmatter. Use the CLI's lifecycle
commands for shipping, blocking, resuming, or superseding a bundle; do not move
spec directories by hand. Archived snapshots remain immutable: add dated
corrections to a living doc or a new spec instead.

After a merge, preview `tomoji docs reconcile` before applying it with `--yes`.
Confirm what each PR actually delivered before interpreting an archive as
acceptance. A documentation PR can merge before physical QA is complete.
The reconcile CLI currently uses standard `gh` authentication internally; use
`ghx` to verify GitHub state when that authentication is unavailable, and
record a skipped reconcile honestly instead of substituting guessed state.

Generate the index after additions or lifecycle changes:

```bash
tomoji docs index --write --json
```

CI runs the repo-contained `pnpm docs:verify` link/spec gate. It does not
install Tomoji or automatically reconcile merged specs; a maintainer must run
the lifecycle/index/audit gates in an environment with Tomoji available.

## Preserving a Workstream

Start with [the project handoff](../../docs/context/project-handoff.md). Preserve
the implementation timeline, decisions and rationale, complete PR/issue
references, evidence limitations, remaining gates, and safe resumption steps.
Use paginated structured GitHub responses to establish source coverage.

Keep public metadata and sanitized summaries in Git. Keep raw API discussion
records and private operational notes in ignored `.private/`, with a local
inventory and checksums. Never commit credentials, PINs, cookies, tokens,
audio, raw personal transcripts, or deployment identity/policy exports.
Private preservation needs a separate secure backup; a fresh clone does not
contain `.private/`.

## Verification

Run these from the repo root after meaningful docs changes:

```bash
pnpm docs:verify
tomoji docs index --verify --json
tomoji docs audit --json
git diff --check
```

For code changes, also run the project checks:

```bash
pnpm test
pnpm build
```

Pass criteria: the docs index is in sync, `tomoji docs audit` reports no new
warnings or critical findings, and any code checks relevant to the change pass.
