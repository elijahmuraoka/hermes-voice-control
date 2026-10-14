# Resumption And Retirement

This is a plan, not a record of execution or permission to mutate services.
Start at the [project handoff](../../../../context/project-handoff.md).

Updated scope, 2026-10-14: the operator chose retirement without requiring an
accepted replacement or a separate raw/private recovery archive. The
[remote-only decision](../../../../decisions/2026-10-14-remote-only-retirement.md)
supersedes earlier fallback-retention prerequisites. The acceptance matrix
below is preserved for a future revival, not an active production goal.

## Resume Safely

1. Read the handoff, architecture, decision register, ledgers, and coverage map.
   Check the current remote main/PR state using `ghx`; the dated snapshot is
   deliberately frozen.
2. Inventory the host and worktrees before repair. Use `wt` for a new scoped
   branch. Preserve dirty private evidence, active sessions, and existing
   services. Do not infer a dead runtime from a sandbox-only network failure.
3. Inspect the installed Hermes version and current serve/voice contract.
   The [July API contract](../../../archived/2026-07-04-hvc-production-path/context/hermes-serve-api.md)
   is a historical integration reference, not a promise of API compatibility
   across upgrades. Never stop the main gateway to run an experiment.
4. Verify operator-device state read-only: correct active tailnet, Tailscale
   VPN active, DNS accepted, approved access to the private HTTPS endpoint.
   Peer ping alone does not prove TCP authorization, TLS, or DNS. Avoid Funnel
   or public tunnels as an access workaround.
5. Run source verification from a fresh checkout/worktree with mock providers:
   `pnpm install --frozen-lockfile`, `pnpm verify`, `pnpm smoke:browser`,
   `pnpm env:check`, docs audit/index, `git diff --check`, and independent review
   of the exact head. Treat existing scripts as data and inspect before use.
6. With approved local credentials, verify the deployed same-origin path:
   minimal readiness, unauth 401, login cookie flags, authenticated details,
   actual agent text/context/interrupt, Gemini STT/Live, and Hermes TTS. Report
   statuses/timings only; never print PINs, session cookies, tokens, or raw
   personal responses. Do not restart unrelated services.

## Real Device Acceptance

Automated browser mocks and screenshots do not replace these checks:

- On the intended iPhone Safari and installed PWA, open the single private URL,
  unlock once, return later, and verify remembered-device behavior.
- Hold, speak a normal sentence, release, see one assembled message, and hear
  the agent's configured voice. Test silent switch, headphones/speaker,
  microphone denial, short press, silence, long pause, and visible capture cap.
- Verify disclosure is visible with the drawer closed. Confirm standalone
  PCM-only capture works without browser recognition.
- Ask two related questions and verify the correct Hermes session carries
  context, not merely the browser transcript.
- Interrupt a spoken answer; ensure audio stops and a fresh hold succeeds.
  Slow work must remain visible/cancellable, not permanently "thinking".
- In optional Live, test switch-away/return, lock/unlock, reconnect, deliberate
  end, retry, and permission-needed behavior. No invisible microphone session
  or repeated cancellation spam is acceptable.
- On the MacBook, verify the same HTTPS/auth/chat/voice path. Record actual
  device, OS/browser, UTC time, source/runtime head, and result per check.

Durability acceptance separately requires approved restart/reboot/logout tests
of the installed HVC service, with healthy recovery and no unrelated gateway
changes. A child-process restart is a useful gate, not the whole gate.

## Compare An Upstream Replacement

Prefer a small reversible trial of native Hermes voice first. If phone access
requires another client or ChatGPT remote connection, specify the smallest
authenticated bridge to the persistent Hermes session. Use supported auth,
explicit approval behavior, and the desired voice; do not expose a dashboard
token to the phone or make arbitrary tools callable publicly.

Compare the exact tasks above, not demo polish. Decide whether exact Hermes
TTS identity or duplex latency is more important when upstream modes use
different speech providers. If a future operator wants continuity during a
migration, accept the new path and demonstrate rollback before switching.
That is a future deployment choice, not a prerequisite for current retirement.

## Resolve Open Records Without Rewriting History

| Record | If reviving HVC | Current retirement disposition |
| --- | --- | --- |
| #20 / draft #25 | Attach actual device results; compare draft to current source | Closed not planned/unmerged; physical QA did not pass by closure |
| #33 | Attach installed service and full recovery acceptance | Closed not planned because the custom runtime is being retired |
| #36 | Verify each operator's private URL access and policy intent | Closed not planned; no policy change or replacement acceptance implied |
| #65 | Fix/test the retained local adapter or explicitly remove that fallback in a reviewed PR | Closed not planned; its defect is still real despite the primary API delivery |
| #87 | Research supported dependency versions and test a fresh upgrade | Closed unmerged; old proposed updates did not ship |

Do not leave a paused goal as the canonical work record. Repository docs and
issue disposition should carry the durable context; a goal's administrative
status must reflect actual scope and gates, not hide unresolved acceptance.
Changing/deleting a goal is separate from deleting its supporting artifacts.

## Preserve Before Retiring

- Merge the reviewed documentation PR only with approval; set the explicit
  spec `pr:` reference and use doc-maintenance lifecycle reconciliation.
  Document archival as a frozen contract, not production acceptance.
- Verify public main contains the complete handoff/ledgers and can be cloned.
  Keep Git history; do not squash/delete the repository to simplify closure.
- Make useful technical context and recoverable code independent of local
  `.private/`. Publish sanitized findings/decisions and verify remote code refs;
  do not upload raw private payloads or keys. A raw private archive is optional,
  not an operator-selected prerequisite for this engineering handoff.
- Inventory active HVC services, worktrees, tmux/cloud sessions, and artifacts.
  Cleanup is audit/classify/preview first. Delete only explicitly approved,
  exact safe targets; retain dirty trees and recovery evidence.
- Stop/disable only HVC services after exact-target preview and approval.
  Do not stop the Hermes gateway, change tailnet policy, revoke shared keys,
  or remove unrelated sessions as incidental cleanup.

The [dossiers](../context/retirement-dossiers.md) contain actual record-closure
receipts. The [execution receipt](../reviews/2026-10-14-retirement-execution.md)
records completed HVC teardown and separately approval-gated Hermes Serve
logging repair. This revival plan never grants future execution permission.
