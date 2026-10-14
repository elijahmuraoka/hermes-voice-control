# Decision Register

Snapshot: 2026-10-07. This records implementation choices and their rationale,
not renewed authorization. Current source is the authority for behavior;
archived plans explain intent and may predate fixes.

## Product And Architecture

| Decision | Rationale and consequence | Evidence / revisit trigger |
| --- | --- | --- |
| Private phone/laptop agent surface, not a second agent | The user wanted their actual Hermes agent's context and tools, not Gemini renamed as the agent | [Vision](../../../../VISION.md), #63, #69; any replacement must prove actual delegation |
| Generic public product; configurable agent name | Others must be able to use their own Hermes agent; personal naming is local configuration, not public API identity | #5, #11; exact PR titles remain historical references |
| Orb-first stage and transcript chat drawer | Voice stays primary; ordinary typed chat and recovery remain available without debug/tool-call UI | #41, #52, #71, #78, #80 |
| Hold default, Live explicit option | Deliberate utterances are understandable and interruptible; continuous conversation is optional | #58, #71; change only after real phone evidence |
| Both modes voice-first | Transcribing input but returning only text did not satisfy the requested product | #81, #82; compare supported upstream voice before more custom audio work |
| Gemini Live behind a provider boundary | Initial practical realtime transport while allowing later substitution without rewriting app states | #21, #27; not a claim of an exhaustive live provider bakeoff |
| Gemini not the authority for agent work | Live answers must first go through the narrow Hermes tool path; display naming alone is insufficient | #63, current Live setup/tool gating; recheck protocol after provider changes |
| Stateful Hermes serve API as primary bridge | The one-shot CLI had no continuity and roughly 34-second latency; API supports stream/resume/interrupt | #66, #69, #75; revalidate gateway protocol on upgrades |
| Keep local subprocess fallback explicit | Portable development/fallback without forcing a live API deployment | #65 remains open; do not infer API context fixes also repaired the fallback |
| Stable remembered-device principal | Normal session refresh must not orphan agent memory; per-device context remains separately scoped | #70, #79, current `device_principal()`; device revocation changes identity |
| Visible background jobs plus inline fast path | Slow work must be cancellable/recoverable without imposing a polling delay on fast answers | #50-#53, #80; job records are not durable worker execution |
| PCM capture plus Gemini STT, browser recognition optional | Real audio improves final transcription; browser interim text gives feedback, but standalone iOS may lack a working recognizer | #72, #76, #78; disclose Google cloud processing and test devices |
| One utterance, one send, bounded capture | Recognition restarts and delayed callbacks must not fragment or duplicate input; long pauses/release watchdog prevent a stuck mic | #72, #76; keep exactly-once and teardown regression tests |
| Reuse Hermes TTS for Hold | The agent already owns its configured voice; another Gemini TTS layer would select the wrong voice and duplicate policy | #81; Live Gemini speech remains a distinct voice path |
| Web Audio playback after gesture unlock | Delayed answers arrive outside an iOS tap gesture; naive HTML audio autoplay fails | #81, #82; real-device delayed-resume acceptance remains necessary |
| Bounded reconnect, not blind reconnect | Survive dropped sockets/token lifetime while respecting deliberate end and healthy tab returns | #77; generation checks must cover every asynchronous continuation |
| Optional wake lock and boundary-only earcons | Keep active voice usable without burning background CPU, draining parked screens, or chiming over speech | #77, #78, #80; degrade silently on unsupported platforms |
| CSS transform/opacity choreography, no motion dependency | Quiet reactive design within explicit bundle and lifecycle budgets | #78; rAF must stop idle/hidden, reduced motion honored |

## Security And Operations

| Decision | Rationale and consequence | Evidence / revisit trigger |
| --- | --- | --- |
| Tailscale Serve private HTTPS, no Funnel workaround | Agent access remains restricted to approved operators; cloud hosting is not a fix for local-agent/network authorization | #22, #32, #36; public exposure requires a separate threat model and explicit approval |
| Same-origin production API | A remote client's localhost is not the host serving the agent; prevents apparent PIN/chat failure | #39; test the deployed proxy routes as well as FastAPI |
| PIN/session plus remembered-device cookie | Defense in depth beyond network membership, without repeated long-PIN entry | #4, #70; 90-day default device lifetime is configurable, logout/revocation must be verified |
| Exposed PIN requires approved rotation | Conversation exposure is a real credential event; never reproduce the value in docs | Historical approved rotation; no new rotation performed here |
| Keys/dashboard token stay server-only | Browser can use short-lived Live credentials, not the agent's long-lived secrets | #3, #23, #69, #76, #81; verify auth/error/log boundaries after each endpoint change |
| Minimal public readiness, private details | A health URL is not a public configuration inventory or proof of agent execution | #64, #68, #80; missing checks must show unknown, 401 must re-authenticate |
| No automatic approval responder | HVC must not convert a speech client into unconditional authority over agent actions | #10, #69; permission requests require desktop approval until a separately reviewed interaction exists |
| Local fallback read-only; API obeys Hermes policy | HVC confirmation records only record intent; the configured agent has its own tools and approval rules | `adapters.py`, `hermes_api.py`; do not advertise all API agent work as inherently read-only |
| No audio persistence; private transcript boundaries | Held audio remains in memory and is sent only to configured transcription; logs/evidence must not expose content | #76, #79; browser transcript cache is private device data, not public evidence |
| Both global and per-peer PIN attempt caps | A proxy can collapse peers; untrusted headers cannot become authorization and must not bypass all throttling | #79 independent review |
| Durable service desired, tmux only fallback | Always-on claims require installed-service/recovery acceptance, not a pane that currently runs | #33, #37, #59; historical child restart is not reboot/logout proof |
| Worktrees, ghx, independent review, integrated gates | Keep main/runtime ownership clear and catch lane-to-lane regressions before deployment | PR discussions and July notes; capture exact head, unmasked exit status, merged-tree verification |
| Public summary plus ignored raw evidence | Portable history must not publish credentials, personal messages, or deployment policy; private material needs separate backup | #19, #29, #31 and this preservation spec |

## Maintenance Direction

As of 2026-10-07, evaluate upstream Hermes voice before expanding HVC. The
[dated decision](../../../../decisions/2026-10-07-upstream-first-voice.md)
separates native voice, desktop, ChatGPT remote connections, community clients,
and bounded action routing. None was accepted as the live replacement here.

Do not "clean up" history by treating closed-unmerged dependency PRs as shipped,
archived specs as physical acceptance, or planned service changes as installed.
Each open gate must be completed, explicitly superseded, or retained with its
reason; queue emptiness is not a production criterion.
