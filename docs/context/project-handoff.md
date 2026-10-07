# Project Handoff

Updated 2026-10-07. Source baseline:
[`c7c501f`](https://github.com/elijahmuraoka/hermes-voice-control/commit/c7c501f51c2649883cab291390b297a673af17c0).
This preservation update changes documentation, not runtime behavior.

## Direction

Preserve HVC as a private custom-client fallback. Evaluate maintained upstream
Hermes voice before investing in another bespoke voice stack. A replacement
has **not** been installed, tested against the operator's phone, or accepted.
The repository has **not** been retired, and services have not been stopped.

The operator wanted reliable access to their existing Hermes agent: persistent
context, natural permission handling, quick interruption, accurate speech,
and spoken answers. The purpose was never to build a second agent personality.
See the [upstream-first decision](../decisions/2026-10-07-upstream-first-voice.md).

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

## Open Records At Capture

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

No record was closed merely to make the queue look complete. Decide whether
these gates remain necessary for a retained fallback or become superseded by
an accepted replacement; record that reason explicitly.

## Preservation Boundary

Git contains portable technical context and reference metadata. Full GitHub
discussion payloads and deployment notes are retained locally under ignored
`.private/closeout-2026-10-07/`. Existing private evidence remains in place.
It is not in a fresh clone and needs a separate secure backup.

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
