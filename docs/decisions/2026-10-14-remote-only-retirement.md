# Remote-Only Retirement

Date: 2026-10-14; resolution updated 2026-10-15. Status: operator-approved
retirement executed for the exact HVC targets and extra HVC API instance. See the
[execution receipt](../specs/active/2026-10-07-hvc-context-closeout/reviews/2026-10-14-retirement-execution.md).
Supersedes the retirement prerequisite in the
[upstream-first decision](2026-10-07-upstream-first-voice.md).

## Decision

End active HVC development and remove its approved local deployment/checkouts.
Keep the GitHub repository alive as the durable engineering memory. A future
agent must be able to recover the project from code, docs, preserved remote
refs, and linked GitHub discussions without this conversation or the old host.

The operator explicitly approved closing abandoned issues and PRs with useful
context and rationale. Closed does not mean fixed, tested on a phone, or
replaced successfully. Selecting/deploying a replacement is not a prerequisite
to this retirement and is not part of this work.

## Why

Custom mobile speech, realtime recovery, authentication, and playback consumed
substantial work. The operator no longer wants an active local installation or
an open queue that implies ongoing investment. Preserving the implementation
and its reasoning has value; retaining running processes and many worktrees
is not the preservation strategy.

## Preservation Contract

- Main is the entry point. PR #88 delivered the reviewed handoff at
  `3d65681684cb892ea2d9c0ef1f3bfa804b4b4e41`; source recovery tags and patches
  were verified remotely before local removal.
- Preserve vision, feature/source map, implementation history, decisions,
  research references, failures/fixes, exact PR/issue dispositions, evidence
  boundaries, and steps for safe resumption.
- Preserve valuable unmerged code as verified remote refs before removing its
  only local copy. Do not merge an abandoned draft merely to preserve it.
- Keep technical context public and generic. Never upload PINs, provider keys,
  session cookies, raw personal transcripts, deployment identity exports, or
  unreviewed private logs. The goal is useful engineering memory, not a raw
  transcript mirror or a credential backup.
- A separate private recovery archive is not required by the operator's chosen
  technical-handoff scope. Identify any private-only useful technical content
  and summarize it safely before an approved deletion. Raw personal history
  is not needed to build/test the project from a fresh clone.

## Verification And Boundaries

A fresh read-only agent, given only the repository entry point, must explain
the implemented architecture, intended UX, key decisions, unsolved gates,
record dispositions, stale-research boundary, and safe next steps. Any missing
technical context found by that test belongs in the repo before cleanup.

Run docs/link/index/audit checks and exact-head CI. Verify remote code refs and
closure receipts. No runtime production-readiness claim follows from those
checks; real mobile/audio and reboot acceptance remain historically incomplete.

The operator approved the exact merge and destructive cleanup preview. That
approval does not authorize future merges or a shared-service repair.
Inventory exact owned targets first; shared Hermes, Tailscale, unrelated
sessions, credentials, and services remain outside the retirement scope.
Scheduled dependency updates are not implicitly disabled by closing one PR;
their configuration is unchanged unless separately reviewed and approved.

See the [project handoff](../context/project-handoff.md),
[feature map](../context/feature-map.md), and
[retirement dossiers](../specs/active/2026-10-07-hvc-context-closeout/context/retirement-dossiers.md).
