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
---

# Doc Maintenance

Use this skill when changing repository documentation, updating active specs, or
checking that docs still match implementation.

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
  local configuration examples or private notes.

## Verification

Run these from the repo root after meaningful docs changes:

```bash
tomoji docs index --verify --json
tomoji docs audit --json
```

For code changes, also run the project checks:

```bash
pnpm test
pnpm build
```

Pass criteria: the docs index is in sync, `tomoji docs audit` reports no new
warnings or critical findings, and any code checks relevant to the change pass.
