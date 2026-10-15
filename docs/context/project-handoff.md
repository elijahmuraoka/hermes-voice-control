# Project Handoff

Updated 2026-10-15. Source baseline:
[`c7c501f`](https://github.com/elijahmuraoka/hermes-voice-control/commit/c7c501f51c2649883cab291390b297a673af17c0).
This preservation update changes documentation, not runtime behavior.

## Direction

HVC is retired as an active development workstream. Preserve its code and
engineering memory on GitHub so a fresh agent can resume without this thread
or the old host. PR #88 merged on main; the approved dedicated HVC runner,
private HTTPS route, four linked worktrees and canonical checkout are removed.
The [execution receipt](../specs/active/2026-10-07-hvc-context-closeout/reviews/2026-10-14-retirement-execution.md)
records verification and the unexpected logging dependency. On 2026-10-15,
the extra HVC API instance was retired after a bounded consumer audit found no
other consumers. Its job, helper and plist are gone; the main Hermes messaging
gateway remained running. No log-path repair or replacement install was needed.

A replacement has **not** been installed or accepted, and is not required to
close HVC. The operator changed that prerequisite on 2026-10-14; the
[remote-only retirement decision](../decisions/2026-10-14-remote-only-retirement.md)
is authoritative over the earlier fallback-retention recommendation.

The operator wanted reliable access to their existing Hermes agent: persistent
context, natural permission handling, quick interruption, accurate speech,
and spoken answers. The purpose was never to build a second agent personality.
See the [upstream-first decision](../decisions/2026-10-07-upstream-first-voice.md).

Use the [feature/source map](feature-map.md) to locate each implemented path,
its tests and remaining limitations. Research and implementation describe
their recorded versions; recheck current Hermes/provider contracts before
adoption or revival. Closed records can be reopened or replaced by new scoped
issues/PRs; historical approvals are never execution permission.

## Reading Order

1. [Vision](../VISION.md) and [architecture](../ARCHITECTURE.md): intent and
   current source behavior.
2. [Implementation history](../specs/active/2026-10-07-hvc-context-closeout/context/implementation-history.md):
   sequence, regressions, remedies, and review provenance.
3. [Decision register](../specs/active/2026-10-07-hvc-context-closeout/decisions/decision-register.md):
   rationale, tradeoffs, and conditions for revisiting choices.
4. [PR ledger](../specs/active/2026-10-07-hvc-context-closeout/context/pull-request-ledger.md)
   and [issue ledger](../specs/active/2026-10-07-hvc-context-closeout/context/issue-ledger.md):
   every GitHub record available at capture time, including closed-unmerged PRs.
   The [main commit ledger](../specs/active/2026-10-07-hvc-context-closeout/context/main-commit-ledger.md)
   also preserves direct repairs and pre-PR commits.
5. [Evidence and coverage](../specs/active/2026-10-07-hvc-context-closeout/audits/evidence-and-coverage.md):
   what was captured, actually checked, reported historically, or unavailable.
6. [Resumption and retirement](../specs/active/2026-10-07-hvc-context-closeout/plans/resumption-and-retirement.md):
   acceptance gates, open-record disposition, and safe operating boundaries.

## What Was Delivered

Main includes stateful Hermes API sessions, recoverable chat jobs, default
Hold capture with Gemini STT, streamed transcript UI, private authentication,
Live reconnect, a PWA shell, orb/accessibility polish, and Hermes TTS for Hold.
The latest merged feature fix is [PR #82](https://github.com/elijahmuraoka/hermes-voice-control/pull/82),
the iOS silent-switch playback correction. Direct integration fixes are
recorded separately in the history; they are not invented PRs.

These are source facts and historical evidence, not a fresh production audit.
In particular, the July production-path spec was automatically archived after
its associated documentation PR merged even though phone acceptance remained
open. The archive label does not satisfy that acceptance gate.

## Abandoned Records And Their Context

The following were open in the October 7 capture. The operator now approved
closure, not completion. The [retirement dossiers](../specs/active/2026-10-07-hvc-context-closeout/context/retirement-dossiers.md)
record original requests, proposed code, progress, unsolved gates, exact remote
heads, rationale, resumption instructions and authoritative closure receipts.

- [#20 / draft PR #25](https://github.com/elijahmuraoka/hermes-voice-control/issues/20):
  physical mobile/browser/audio acceptance.
- [#33](https://github.com/elijahmuraoka/hermes-voice-control/issues/33):
  durable private runner; historical crash recovery is not full reboot proof.
- [#36](https://github.com/elijahmuraoka/hermes-voice-control/issues/36):
  private HTTPS/operator access evidence and policy acceptance.
- [#65](https://github.com/elijahmuraoka/hermes-voice-control/issues/65):
  local subprocess fallback context defect; the API adapter solves the primary
  path, not every fallback implementation.
- [PR #87](https://github.com/elijahmuraoka/hermes-voice-control/pull/87):
  unmerged frontend dependency update, not part of the voice delivery.

No physical/reboot/fallback test is invented to justify closure.
[PR #88](https://github.com/elijahmuraoka/hermes-voice-control/pull/88) delivered
this handoff on main at `3d65681684cb892ea2d9c0ef1f3bfa804b4b4e41`.
The repository stays editable; abandoned records are history, not an active
roadmap. Weekly dependency automation is unchanged and may create new PRs.

## Preservation Boundary

The [local recovery inventory](local-recovery-inventory.md) classifies branch
tips and generated evidence. [Source recovery snapshots](recovery-snapshots/README.md)
preserve useful unpublished variants as reviewed, untested patches on public
bases, without exporting private Git ancestry. The dossiers pin remote tags
for implemented source and abandoned drafts. These artifacts are code memory,
not permission to execute an old patch or claim it is better than current main.

Git contains portable technical context and reference metadata. Project-local
ignored discussion captures, deployment notes, databases, logs, environment
files and transcript copies were removed with the approved canonical checkout.
They were never uploaded. Global agent histories and shared credentials were
left alone. The operator did not require a private recovery archive; useful
technical findings, reviewed source patches and remote refs were preserved
first. A fresh agent supplies new credentials and refreshes research instead
of depending on the former host or PIN.

Historical tracked docs already contain deployment identifiers; this PR's
changed-file scan is not a clean-tree or clean-history claim. The
[coverage map](../specs/active/2026-10-07-hvc-context-closeout/audits/evidence-and-coverage.md)
records the inherited exceptions and separately gated redaction decision.
The preservation bundle is manually retained so reconciliation cannot break
this handoff's links; an approved archive must repair those links atomically.

Not every historical agent session has been exported or fully read. The
coverage map names those gaps. Historical instructions and approvals are
provenance, not current permission to merge, install, delete, rotate secrets,
change tailnet policy, or restart a service.

## Cold-Start Acceptance

A new read-only agent receives only the repo path/README, no conversation or
private notes. It must reconstruct intent, architecture, feature ownership,
decisions, incidents, research limits, record dispositions and next steps.
The dated review records whether that test actually ran. A readable handoff
is not proof of a fresh live deployment or accepted replacement.
