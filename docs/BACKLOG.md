# Backlog

Snapshot: 2026-10-07, before the preservation PR. GitHub state is enumerated in
the complete [issue ledger](specs/active/2026-10-07-hvc-context-closeout/context/issue-ledger.md)
and [PR ledger](specs/active/2026-10-07-hvc-context-closeout/context/pull-request-ledger.md).
Historical checklists are preserved in their owning specs and Git history;
they are not a current open-issue list.

## Current Direction

Preserve HVC and compare upstream Hermes voice before adding more custom-client
features. No replacement has been accepted. See the
[upstream-first decision](decisions/2026-10-07-upstream-first-voice.md) and
[resumption plan](specs/active/2026-10-07-hvc-context-closeout/plans/resumption-and-retirement.md).

## Open Gates

| Record | What remains | Disposition to decide |
| --- | --- | --- |
| [#20](https://github.com/elijahmuraoka/hermes-voice-control/issues/20), [draft #25](https://github.com/elijahmuraoka/hermes-voice-control/pull/25) | Physical phone/browser/audio acceptance; automated smoke is insufficient | Complete on devices if maintaining HVC; otherwise close as superseded only after accepting a replacement |
| [#33](https://github.com/elijahmuraoka/hermes-voice-control/issues/33) | Full durable reboot/logout/headless acceptance | Historical crash-restart evidence exists; recheck installed service and obtain approval for a reboot/system change |
| [#36](https://github.com/elijahmuraoka/hermes-voice-control/issues/36) | Operator access/policy evidence | Verify real operator devices; no policy mutation inferred from this document |
| [#65](https://github.com/elijahmuraoka/hermes-voice-control/issues/65) | Stateless local-fallback transcript/context defect | Primary API path shipped in #69; fix retained fallback or explicitly retire that fallback |
| [#87](https://github.com/elijahmuraoka/hermes-voice-control/pull/87) | Frontend dependency update | Independently review/test if maintaining; do not merge merely for an empty queue |

## Closed Source Work

The CI, auth, security, provider boundary, diagnostics, real-bridge harness,
chat-job lifecycle, stateful API adapter, transcript/default-Hold UX, STT,
reconnect, design, and Hold TTS deliveries are recorded with their merged PRs
and historical evidence. Their closed status does not remove the open physical
acceptance gates above. In particular, frontend update PR #42 already merged;
it is not an outstanding issue.

## Intentionally Unscheduled

- No broad voice-framework migration, telephony, multi-user rooms, or public
  hosting until a demonstrated need survives the upstream comparison.
- No automatic Hermes approval responder or arbitrary remote tool endpoint.
- No claim that background jobs durably resume after an HVC process crash.
- No service retirement, secret rotation, cleanup deletion, or issue closure
  performed by this preservation update.
