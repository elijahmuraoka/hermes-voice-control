# Docs

Map of documentation for this repo. The `doc-maintenance` skill keeps this current.

## Top-level

| File | Purpose |
|---|---|
| [VISION.md](./VISION.md) | What we're building, why |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System-wide architecture |
| [BACKLOG.md](./BACKLOG.md) | Open work not yet scoped into specs |
| [INDEX.md](./INDEX.md) | This file |

## Categories

| Directory | Purpose |
|---|---|
| [context/](./context/) | Background material: notes, references, research, agent orientation |
| [specs/](./specs/) | Feature specs, see below |

## Specs

| Directory | Purpose |
|---|---|
| [specs/active/](./specs/active/) | Features currently being worked on |
| [specs/archived/](./specs/archived/) | Shipped or superseded specs |

### Active specs

| Bundle | Spec |
|---|---|
| [specs/active/2026-06-07-hvc-hardening-live-verification/](./specs/active/2026-06-07-hvc-hardening-live-verification/) | Harden Hermes Voice Control for private Gemini Live use and document current verification |
| [specs/active/2026-07-04-hvc-production-path/](./specs/active/2026-07-04-hvc-production-path/) | 2026-07-04-hvc-production-path |

### Spec bundle shape

Every active spec is a folder with its own layout. Only `SPEC.md` is required; other files and subfolders are created as needed.

```
docs/specs/active/<name>/
├── SPEC.md                  ← what + why (frontmatter required)
├── architecture.md          ← how it works
├── acceptance-tests.md      ← what must be true to ship
├── implementation-map.md    ← where in code
│
├── audits/                  ← spec-specific audits
├── plans/                   ← spec-specific plans (multiple allowed)
├── reviews/                 ← spec-specific code reviews
├── decisions/               ← spec-specific ADRs
└── context/                 ← spec-specific background
    ├── notes/
    ├── references/
    └── research/
```

Names use `<YYYY-MM-DD>-<feature>` when a date is meaningful, `<feature>` otherwise.

## How the same shape applies at both levels

Top-level `docs/` and each spec bundle share the same mental model:

| Scope | Top-level (system-wide) | Per-spec (feature-specific) |
|---|---|---|
| Architectural decisions | `docs/decisions/` | `docs/specs/active/<name>/decisions/` |
| Background material | `docs/context/` | `docs/specs/active/<name>/context/` |

Rule: if it applies across specs, it's system-wide. If it's tied to one initiative, it lives with that spec.

## Reading order for new agents

1. [VISION.md](./VISION.md) — what we're building
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — how the system works
3. [context/](./context/) — orientation
4. [specs/active/](./specs/active/) — current work

## Maintained by

The [`doc-maintenance` skill](../skills/doc-maintenance/SKILL.md) owns this structure. It handles the spec lifecycle (backlog → active → archived), keeps `INDEX.md`, `VISION.md`, and `ARCHITECTURE.md` current, and bootstraps this pattern in new repos.
