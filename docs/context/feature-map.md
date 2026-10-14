# Feature And Source Map

Implementation baseline: `c7c501f` (2026-10-14 remote-main readback). This maps
retained source, not a live deployment or current upstream compatibility.
Start with [the handoff](project-handoff.md) and [architecture](../ARCHITECTURE.md).

## Product Intent

The browser is a voice surface for an existing Hermes agent, not a second
personality. Default Hold should capture one thought, show it, send it once,
and speak the agent's reply. Optional Live should permit hands-free turns and
interruption. Typed chat shares the transcript and must not dead-end on slow
work. Permissions must be explained rather than silently approved.

## Ownership Map

Display naming does not prove the installed agent identity. API mode uses the
configured Hermes serve profile and creates/resumes an HVC-owned conversation
per principal; different remembered devices are separately scoped. It does
not guarantee attachment to an already-active desktop or messaging thread.
Confirm the intended profile/memory/tools on any revival, rather than calling
a renamed mock or Gemini answer the operator's existing agent.

| Capability | Source and tests | Delivery / remaining limit |
| --- | --- | --- |
| Hold recording, interim words, one assembled utterance, finalization | `apps/web/src/App.tsx`, `audio.ts`, `speechRecognition.ts`; `App.test.tsx`, `audio.test.ts` | #72/#76/#78: PCM capture with optional browser recognition. iOS PWA can operate PCM-only. Roughly 60-second cap, visible disclosure, bounded STT timeout/fallback; physical acceptance incomplete. |
| Gemini STT | `apps/server/app/main.py` `/stt/transcribe`, `gemini.py`, `config.py`; `apps/server/tests/` | #76: session auth, in-memory audio, payload validation, mock mode. Real mode sends audio to Google's API; do not call it local-only recognition. |
| Typed/Hold chat and background work | `apps/web/src/api.ts`, `App.tsx`, `chatJobStorage.ts`; `apps/server/app/chat_jobs.py`, `store.py`, `main.py` | #51-#53/#80: 750 ms default inline budget, then partial-text jobs, cancellation and completion updates. Stored metadata is not restartable in-flight execution. |
| Stateful Hermes bridge | `apps/server/app/hermes_api.py`, `adapters.py`, `store.py`; `apps/server/tests/test_api_hermes_adapter.py` | #69: JSON-RPC create/resume, remembered-device principal, streamed deltas, interruption, approval-needed state. Historical July API contract needs fresh upstream verification. |
| Local fallback | `apps/server/app/adapters.py`, `tools.py`; local adapter tests/harness | Deliberately read-only subprocess, not persistent Bob context. #65's transcript-window defect remains unsolved; do not mistake the API fix for a fallback fix. |
| Hold spoken replies | `apps/server/app/tts.py`, `main.py` `/tts`; `apps/web/src/replyAudio.ts`, `App.tsx`; `replyAudio.test.ts` | #81/#82: Hermes `/api/audio/speak` uses configured agent TTS; gesture-unlocked Web Audio, barge-in, synthesis fallback, iOS silent-switch fix. Phone playback acceptance remains a real-device gate. |
| Optional Live | `apps/web/src/geminiLive.ts`, `realtime/`, `gemini-live/`, `audio.ts`; corresponding tests | #27/#71/#77: ephemeral tokens, agent-tool-first turn routing, configured Gemini voice, bounded reconnect, healthy visibility resume, no deliberate-end reconnect. OS termination/background continuity is not guaranteed. |
| Auth/session and tool policy | `apps/server/app/security.py`, `tools.py`, `main.py`, `config.py`; backend security/API tests | PIN/remembered-device cookies, origin checks, allowlisted tools, server-only secrets. Hermes API approvals require desktop action; HVC confirmation records are not an action executor. |
| Orb, transcript, accessibility and notices | `apps/web/src/components/`, `stateMachine.ts`, `styles.css`, `earcons.ts`; component/state/earcon tests | #78/#80: amplitude/state feedback, reduced motion, retry/cancel affordances, streamed text, mobile notices and hit targets. Historical screenshots are not current device evidence. |
| Private deployment and readiness | `scripts/private-one-origin-proxy.mjs`, `run-private-tailscale.mjs`, `manage-private-launchd.mjs`, `run-private-launchd.mjs`; script tests | #32/#39 plus direct routing repairs. Same-origin browser API is essential; public `/readyz` is minimal, authenticated `/readyz/details` supplies diagnostics. Full reboot/device acceptance was never established. |
| PWA and browser automation | `apps/web/public/`, `scripts/browser-responsive.spec.ts`, `run-browser-smoke.mjs` | #74 and later fixes. Mock smoke cannot prove real mic, Safari standalone speech, silent switch, or OS interruption behavior. |

PR numbers link through the [complete PR ledger](../specs/active/2026-10-07-hvc-context-closeout/context/pull-request-ledger.md).
The [implementation history](../specs/active/2026-10-07-hvc-context-closeout/context/implementation-history.md)
explains the incidents and fix rounds behind this map.

## Fresh-Agent Start

1. Read `README.md`, `AGENTS.md`, the handoff, vision, architecture, this map,
   decision register, history, retirement dossiers and evidence coverage.
2. Refresh current GitHub refs and the installed Hermes/provider contracts.
   Research documents and archived contracts are dated evidence, not authority
   to install, execute tools, spend provider quota, or expose a service.
3. Inspect `.env.example` and `package.json`. Use mock defaults; do not recover
   or require the former operator's PIN, keys, machine identity or database.
4. In an approved fresh worktree, install locked Node/backend dependencies and
   run `pnpm env:check`, `pnpm verify`, `pnpm smoke:browser`, docs/index/audit,
   whitespace and independent review. Real token flow is opt-in, not part of
   mock acceptance.
5. If resuming product work, create/reopen scoped records from the preserved
   unsolved gates. Compare old draft code to current main rather than blindly
   cherry-picking; retire neither shared Hermes nor an operator service as a
   side effect of testing.

Detailed setup remains in README; the
[resumption plan](../specs/active/2026-10-07-hvc-context-closeout/plans/resumption-and-retirement.md)
contains real-device and runtime acceptance gates for a future approved revival.
