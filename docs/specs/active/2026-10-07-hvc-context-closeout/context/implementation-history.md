# Implementation History

This is a reconstruction from repository history, captured GitHub records,
selected review discussions, private execution notes, and the operator's
conversation context. It is not a verbatim export of every agent session.
Snapshot: 2026-10-07; source baseline `c7c501f`. Each historical test result is
reported evidence from its original run, not a test repeated for this closeout.

## Product Intent

The operator wanted a private phone/laptop voice surface for their existing
Hermes agent, known locally as Bob. The public product was generalized to
"your Hermes agent" with an environment-configurable display name. An orb-first
interaction, transcript drawer with ordinary typed chat, natural permission
handling, spoken answers, and no debug-looking badges were explicit priorities.
Maintaining another agent personality or a public hosted voice service was not.

The operator repeatedly rejected PR-ready or green-unit-test reports as a
substitute for a working live app. They asked for scoped worktree PRs,
independent review, integrated verification, docs maintenance, and evidence
with honestly classified external/approval gates.

## Initial Client And Hardening

The early implementation used React/TypeScript/Vite, FastAPI/SQLite, browser
Web Audio, and Gemini Live. Mock adapters kept development hermetic. The local
Hermes bridge was a safe-toolset, read-only one-shot CLI subprocess.

- [#11](https://github.com/elijahmuraoka/hermes-voice-control/pull/11) closed
  initial readiness/review gaps.
- [#21](https://github.com/elijahmuraoka/hermes-voice-control/pull/21) recorded
  the provider decision; [#22](https://github.com/elijahmuraoka/hermes-voice-control/pull/22),
  [#23](https://github.com/elijahmuraoka/hermes-voice-control/pull/23), and
  [#24](https://github.com/elijahmuraoka/hermes-voice-control/pull/24) established
  private release gates, threat modeling, and latency/reliability diagnostics.
- [#26](https://github.com/elijahmuraoka/hermes-voice-control/pull/26) added
  opt-in real Hermes/Gemini verification;
  [#27](https://github.com/elijahmuraoka/hermes-voice-control/pull/27) introduced
  a provider-neutral client boundary without pretending multiple providers
  were already implemented.
- [#28](https://github.com/elijahmuraoka/hermes-voice-control/pull/28) performed
  the integrated gauntlet;
  [#29](https://github.com/elijahmuraoka/hermes-voice-control/pull/29) and
  [#31](https://github.com/elijahmuraoka/hermes-voice-control/pull/31) sanitized
  public evidence paths and credential-like values.

Earlier alternatives research remains in
[open-source voice systems](../../../../context/research/open-source-voice-systems.md)
and the [provider bakeoff](../../../../context/research/realtime-provider-bakeoff.md).
The historical default did not prove Gemini was universally best or that every
alternative had undergone a paid/live comparison.

## Private Access, PIN, And Runtime

[#32](https://github.com/elijahmuraoka/hermes-voice-control/pull/32) added a
tailnet-private runner. [#34](https://github.com/elijahmuraoka/hermes-voice-control/pull/34)
documented deployment status, and
[#37](https://github.com/elijahmuraoka/hermes-voice-control/pull/37) added launchd
tooling. [#43](https://github.com/elijahmuraoka/hermes-voice-control/pull/43)
handled an existing Serve route;
[#59](https://github.com/elijahmuraoka/hermes-voice-control/pull/59) addressed
runner lifecycle. Their existence is not reboot acceptance.

Remote failures had distinct causes, which must not be conflated:

1. Tailscale peer ping established peer reachability, not TCP 443 authorization
   or DNS resolution. The MacBook's Tailscale DNS acceptance was disabled;
   enabling it resolved the observed name-resolution failure. The active
   tailnet, VPN, DNS, and narrow access grant all matter, not simply sharing Wi-Fi.
2. A correct PIN could still appear rejected because the production browser
   called its own localhost API. [#39](https://github.com/elijahmuraoka/hermes-voice-control/pull/39)
   fixed same-origin API routing. Copying a PIN through remote tmux/macOS
   clipboard paths did not diagnose that frontend defect.
3. The original PIN was exposed in conversation and later rotated with explicit
   approval. No value belongs in this record. Subsequent work added remembered
   device auth in [#70](https://github.com/elijahmuraoka/hermes-voice-control/pull/70)
   instead of asking for a long secret on every visit.
4. launchd bootstrap/admin boundaries and tmux fallbacks were reported at
   different times. July private notes report crash-restart success, but full
   reboot/logout/headless acceptance remained open under #33.
5. A July host-down conclusion was a sandbox-networking false alarm. Compare
   an authorized host-side probe before changing a healthy runtime.

Tailnet identities, policy exports, addresses, PIN artifacts, and service paths
remain private. No deployment or policy action was repeated during preservation.

## Chat Could Not Dead-End

The operator demonstrated that even "hello" timed out. Increasing timeouts
alone was not an adequate product response. The release-captain loop separated
latency diagnosis, job lifecycle, transcript UX, and completion notification:

| Issue | Delivery | Purpose |
| --- | --- | --- |
| #46 | [#50](https://github.com/elijahmuraoka/hermes-voice-control/pull/50) | Measure real text latency without dumping private responses |
| #47 | [#51](https://github.com/elijahmuraoka/hermes-voice-control/pull/51) | Visible, pollable, cancellable backend chat jobs |
| #48 | [#52](https://github.com/elijahmuraoka/hermes-voice-control/pull/52) | Slow/background chat remains recoverable in the transcript |
| #49 | [#53](https://github.com/elijahmuraoka/hermes-voice-control/pull/53) | Completion delivered over available voice/text surfaces |

Related fixes: [#41](https://github.com/elijahmuraoka/hermes-voice-control/pull/41)
voice edge regressions, [#44](https://github.com/elijahmuraoka/hermes-voice-control/pull/44)
bounded legacy text handling, [#54](https://github.com/elijahmuraoka/hermes-voice-control/pull/54)
binary Gemini frames, [#55](https://github.com/elijahmuraoka/hermes-voice-control/pull/55)
job-aware harness, and [#57](https://github.com/elijahmuraoka/hermes-voice-control/pull/57)
private live-harness evidence.

Persisted job state supports refresh/recovery visibility. It does not promise
durable execution of an interrupted worker after process restart. UI thinking
must reflect a real pending task, not hide a failure indefinitely.

## Stateful Agent Substrate

The operator correctly questioned the stateless `hermes chat -Q -q` path.
The upgraded Hermes serve protocol enabled session create/resume, streamed
events, interrupt, and permission requests. The archived
[API contract](../../../archived/2026-07-04-hvc-production-path/context/hermes-serve-api.md)
preserves the protocol used at implementation time; recheck it after upgrades.

[#67](https://github.com/elijahmuraoka/hermes-voice-control/pull/67) recorded the
production-path plan; [#69](https://github.com/elijahmuraoka/hermes-voice-control/pull/69)
delivered the API adapter for #66. The old local fallback remains, including
the separately tracked #65 context defect.

Independent review caught three important adapter bugs: pending-frame busy
spinning, accepting a previous turn's completion after queued/steered submits,
and giving client-supplied system transcript entries instruction authority.
Fixes scanned pending frames without requeue spinning, handled submission/turn
semantics, and demoted untrusted system context. See the
[review findings](https://github.com/elijahmuraoka/hermes-voice-control/pull/69#issuecomment-4881290771).

The [dedicated real-serve gate](https://github.com/elijahmuraoka/hermes-voice-control/pull/69#issuecomment-4881355218)
reported warm first token 1.4-2.0 seconds versus the roughly 34-second local
subprocess baseline, context carry, and about 2 ms interrupt resolution.
Its cold first turn was 6.6 seconds, motivating
[#75](https://github.com/elijahmuraoka/hermes-voice-control/pull/75) unlock-time
warming. These are historical measurements, not an ongoing performance SLA.
Current source keys agent context to a remembered-device principal when
available, correcting older notes that tied all context to session rotation.

[#68](https://github.com/elijahmuraoka/hermes-voice-control/pull/68) minimized
unauthenticated readiness. Detailed diagnostics now require auth.
[#71](https://github.com/elijahmuraoka/hermes-voice-control/pull/71) made Hold
the default, streamed partial agent text, and added truthful working/connection
indicators. [#61](https://github.com/elijahmuraoka/hermes-voice-control/pull/61)
made the configured Gemini voice constraint authoritative; that voice was not
the agent's configured ElevenLabs voice.

## Hold, Transcription, And Real iOS Behavior

[#58](https://github.com/elijahmuraoka/hermes-voice-control/pull/58) introduced
explicit Basic Hold; [#60](https://github.com/elijahmuraoka/hermes-voice-control/pull/60)
handled early recognition end. Real iPhone testing then showed missing mic
permission prompting and one-word fragmented sends.

[#72](https://github.com/elijahmuraoka/hermes-voice-control/pull/72) primed the
mic permission and assembled one utterance across recognition restarts. Review
then caught silently exhausted restart budgets and a missing release watchdog.
The fixes ended long pauses visibly and settled release even if `onend` was
dropped, permitting the next hold. See its
[fix summary](https://github.com/elijahmuraoka/hermes-voice-control/pull/72#issuecomment-4890242871).

Browser dictation remained too inaccurate. [#76](https://github.com/elijahmuraoka/hermes-voice-control/pull/76)
reused the PCM16/16 kHz audio worklet, held an in-memory capped buffer, and
finalized through authenticated Gemini STT. Browser recognition became interim
display/fallback rather than final authority. Review required accurate Google
cloud disclosure, duration-scaled timeouts, skipping uploads whose result would
be discarded, visible cap feedback, honest auth-failure status, generic errors,
and exactly-once fallback tests. The
[review history](https://github.com/elijahmuraoka/hermes-voice-control/pull/76#issuecomment-4895282058)
records acceptance after the fix round.

[#74](https://github.com/elijahmuraoka/hermes-voice-control/pull/74) enabled an
installable PWA. Standalone iOS exposed another platform limit: detectable
Web Speech could fail with `service-not-allowed`. The
[#78 fix/polish round](https://github.com/elijahmuraoka/hermes-voice-control/pull/78#issuecomment-4896550614)
kept PCM capture alive when server STT was usable, including unavailable
recognizers, while real microphone permission failures still failed clearly.
Recognition-free capture relies on release, not recognition restarts, to end.

## Recovery And Design

[#77](https://github.com/elijahmuraoka/hermes-voice-control/pull/77) added bounded
Live reconnect with token refresh, audio resume, feature-detected wake lock,
connection polling, visible retry, and finalizing feedback. Adversarial review
found a ghost socket/hot mic after deliberate end during token mint, forced
reconnect of healthy tabs, capture teardown races, and parked wake locks.
Generation/identity checks and cleanup tests resolved them. See the
[review verdict](https://github.com/elijahmuraoka/hermes-voice-control/pull/77#issuecomment-4894628009).

[#78](https://github.com/elijahmuraoka/hermes-voice-control/pull/78) implemented
the alive-orb design: amplitude feedback, state choreography, quiet hierarchy,
gesture-unlocked boundary-only earcons, accessible state copy, reduced motion,
and mobile/desktop state screenshots. Reconnect chimes and Live reply chimes
were removed to avoid repetitive/overlapping audio. Bundle ceilings were
explicitly raised rather than deleting requested features to fit a budget.

## Integration Incidents And Audit Remediation

Private July notes record two integration defects that green lane tests missed:

- Retargeting the #77/#78 stack left conflict markers in seven files; a piped
  command masked failure. Direct commit
  [`abcbfba`](https://github.com/elijahmuraoka/hermes-voice-control/commit/abcbfba)
  repaired the source. Inspect exact merged trees and preserve command exits.
- The deployed proxy did not forward `/stt`, and served the web manifest with
  the wrong MIME type. Direct commit
  [`e8d0217`](https://github.com/elijahmuraoka/hermes-voice-control/commit/e8d0217)
  repaired them. Test the deployed same-origin proxy, not only backend routes.

The post-merge audit queue reported 25 accepted findings. Backend/security
remediation landed in [#79](https://github.com/elijahmuraoka/hermes-voice-control/pull/79),
including logout/re-mint hygiene and both global and per-peer PIN attempt caps
([independent review](https://github.com/elijahmuraoka/hermes-voice-control/pull/79#issuecomment-4898255898)).
Client remediation landed in [#80](https://github.com/elijahmuraoka/hermes-voice-control/pull/80):
mobile disclosure/cap visibility, restored 750 ms inline chat budget, locked or
unknown readiness truth, reconnect escape/retry controls, less aria-live spam,
plain copy, 44 px targets, resumed earcons, and hierarchy/focus polish.

The July spec was auto-archived by
[`caec5d8`](https://github.com/elijahmuraoka/hermes-voice-control/commit/caec5d8)
after its associated PR merge. Its own contract reserved acceptance for
physical phone/laptop QA. This archival is not evidence that those tests or
the reboot gate happened; the correction is outside the immutable archive.

## Voice-First Hold

Text-only Hold answers violated the core intent. Discovery of Hermes serve's
existing `/api/audio/speak` made a new Gemini TTS stack unnecessary.
[#81](https://github.com/elijahmuraoka/hermes-voice-control/pull/81) proxied the
existing configured Hermes voice (the operator's ElevenLabs voice), then
decoded/played its audio through a gesture-unlocked AudioContext. Generation
checks support barge-in; transcript text and last-resort browser speech remain.
The [independent review](https://github.com/elijahmuraoka/hermes-voice-control/pull/81#issuecomment-4902365336)
accepted the architecture but explicitly required physical iOS validation of
delayed context resume. Direct commit
[`ab3665e`](https://github.com/elijahmuraoka/hermes-voice-control/commit/ab3665e)
forwarded `/tts` through the deployed proxy.

[#82](https://github.com/elijahmuraoka/hermes-voice-control/pull/82) added iOS
playback audio-session handling for the silent switch. It is the captured
main tip, not proof that every device/audio combination passed afterward.

## Management And Current Closeout

Implementation eventually used bounded worker lanes with a Claude
orchestrator/reviewer integrating the stack; Codex implemented substantial
assigned chunks. Earlier production attempts and roles varied. The transcript
does not establish that one persistent Claude session owned every prior turn.
Historical review helpers sometimes ran without a terminal verdict; bounded
review with concrete findings is required, not an indefinite wait or a claim
that running a helper itself proves quality.

Dependency/workflow work also shipped in #35 and #42; six dependency PRs closed
unmerged. The complete ledgers prevent selective recall of only feature PRs.
As of October, upstream voice capabilities prompted reevaluation. Preserve
HVC, evaluate a replacement against the actual operator workflow, and close
superseded records explicitly only after that decision. Neither upstream
adoption nor repository/service retirement happened in this preservation pass.
