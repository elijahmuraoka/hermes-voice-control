# Open-source Voice Systems Research

Reviewed on 2026-06-07. Popularity and activity are snapshots from public
GitHub/search results and should be refreshed before a framework decision.

## Shortlist

| Project | Snapshot | HVC relevance | Recommendation |
|---|---:|---|---|
| [LiveKit Agents](https://github.com/livekit/agents) | 10k+ stars, active releases | Realtime programmable voice/video agents, WebRTC clients, telephony, MCP support, and Gemini Live examples. | Learn from its production agent lifecycle and media transport model. Do not migrate HVC unless we need rooms, telephony, or hosted workers. |
| [LiveKit server](https://github.com/livekit/livekit) | 18k+ stars, large WebRTC stack | Production SFU, JWT auth, client SDKs, and realtime audio/video/data plumbing. | Consider only if HVC outgrows direct browser-to-Gemini transport. |
| [Pipecat](https://github.com/pipecat-ai/pipecat) | 12k+ stars, active Python framework | Voice/multimodal agent pipelines, provider integrations, transports, VAD, STT/TTS, Gemini Multimodal Live and OpenAI Realtime support. | Best architectural comparator for a provider-neutral backend pipeline. Keep custom v1 for now. |
| [OpenAI Realtime Agents](https://github.com/openai/openai-realtime-agents) | 6k+ stars, official demo | Browser realtime voice patterns, ephemeral session endpoint, tool UI, guardrails, and supervisor/handoff flows. | Use as a reference for realtime UI and tool orchestration tests, not as a Gemini replacement. |
| [Ultravox](https://github.com/fixie-ai/ultravox) | 4k+ stars, speech-native model repo | Multimodal speech LLM that avoids a separate ASR stage and exposes realtime voice-agent paths. | Track as a model/backend alternative, not an HVC app framework. |
| [Vocode Core](https://github.com/vocodedev/vocode-core) | 3k+ stars, older voice-agent framework | Modular STT/LLM/TTS streaming conversations, phone/browser/Zoom history. | Useful for abstraction history; lower priority because public activity appears slower than LiveKit/Pipecat. |
| [Piper](https://github.com/rhasspy/piper) | 11k+ stars, archived and moved | Local neural TTS component used in Home Assistant/Rhasspy-style stacks. | Component reference for offline speech, not a full HVC-like system. |

## What HVC Should Borrow

- LiveKit: lifecycle vocabulary for sessions, participants, dispatch, and
  telephony if voice grows beyond one private browser.
- Pipecat: explicit pipeline boundaries, provider-neutral audio processors, and
  debugging/observability concepts.
- OpenAI Realtime Agents: browser-side event logs, scenario switching, ephemeral
  token endpoint patterns, and guardrail presentation.
- Ultravox/Piper: offline or speech-native fallback ideas if Gemini Live becomes
  too vendor-specific.

## What HVC Should Avoid For Now

- A framework migration before the current Gemini Live path has completed a real
  credentialed smoke test.
- Telephony-oriented complexity until there is a real phone-call use case.
- Public/open remote exposure before a secret scan and private-context review.
