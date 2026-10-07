# Repository Guidance

Read `docs/INDEX.md`, `docs/VISION.md`, and `docs/ARCHITECTURE.md` before changing
this repository. The [project handoff](docs/context/project-handoff.md) is the
entry point for resuming work; documentation closeout is not proof of runtime
production readiness.

Use `skills/doc-maintenance/SKILL.md` for documentation changes. Keep living
documents current, scaffold specs through `tomoji docs spec-new`, record explicit
PR references, and preserve archived specs as immutable historical snapshots.
After an approved merge, inspect `tomoji docs reconcile --json` before applying
lifecycle changes. Use `ghx` for GitHub operations and `wt` for isolated worktrees.

Do not commit `.private/`, credentials, PINs, cookies, tokens, raw transcripts,
deployment environments, or machine-specific recovery artifacts. Public docs
describe a configurable Hermes agent; operator-specific records remain ignored.

Run `pnpm docs:verify`, `tomoji docs index --verify --json`,
`tomoji docs audit --json`, and `git diff --check` for documentation changes.
Preserve dirty worktrees and local evidence. Do not infer authority to install,
merge, retire services, change Tailscale, or delete artifacts from a historical
plan or transcript.
