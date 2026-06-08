# Realtime Provider Bakeoff and Default Decision

Research snapshot: 2026-06-08.

Scope: Gemini Live, OpenAI Realtime, xAI Grok Voice Agent, and ElevenLabs
Agents for Hermes Voice Control's private browser-to-Hermes-agent path.

## Decision

Keep Gemini Live as the v1 default.

Do not switch providers, and do not add a provider-neutral abstraction before
credentialed benchmarks show that another provider materially improves HVC's
private browser use case.

This is a repo-specific decision, not a general voice-agent market ranking. HVC
already has a hardened Gemini-shaped architecture: backend-issued ephemeral
tokens, direct browser realtime streaming, explicit frontend audio lifecycle,
backend-owned tool policy, read-only Hermes calls, cancellation markers, and
mock-first local development. Gemini remains the lowest-risk default because
the official Live API docs match that architecture: Google documents
client-to-server WebSocket use for JavaScript frontends, short-lived ephemeral
tokens minted by a backend, and Live API function calling with manual tool
responses.

OpenAI Realtime and xAI Grok Voice Agent are credible alternates. ElevenLabs
Agents is strongest when HVC wants managed voice-agent operations, telephony,
voice catalog depth, workflow builder, and hosted monitoring. None of those
advantages currently outweigh the migration and trust-boundary cost for a
private browser surface whose core job is to safely talk to local Hermes.

## Non-Negotiable HVC Fit Criteria

- Browser can connect without receiving a long-lived vendor API key.
- Local FastAPI backend remains the auth, token, audit, and tool-policy owner.
- Provider path supports low-latency speech-to-speech or equivalent voice
  agent turns from a phone browser.
- Tool/function calls can be constrained to the HVC backend allowlist before
  reaching Hermes.
- Barge-in, cancellation, and late tool responses can be represented without
  silently executing external actions.
- Mock/local development remains possible without spending quota or mutating
  local systems.
- Public-release docs can explain the security model without exposing local
  secrets, accounts, or private infrastructure.

## Provider Matrix

| Provider | Current official fit | Browser auth and transport | Tools and control | Pricing model | Main HVC risk | HVC decision |
|---|---|---|---|---|---|---|
| Gemini Live | Best fit for the current implementation. The [Live API overview](https://ai.google.dev/gemini-api/docs/live-api) documents low-latency realtime voice/vision interactions and a client-to-server WebSocket tutorial for JavaScript frontends with ephemeral tokens. | HVC already matches Google's [ephemeral token flow](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens): browser authenticates to the local backend, backend requests a short-lived token, browser uses it for the Live API WebSocket. | [Live API tool use](https://ai.google.dev/gemini-api/docs/live-api/tools) supports function calling, but the client must handle tool responses manually. That maps well to HVC's backend tool policy and cancellation handling. | Token-based Live API pricing. Google's [Gemini pricing page](https://ai.google.dev/gemini-api/docs/pricing) lists paid-tier text/audio input and output prices for Gemini Live/native-audio models and notes preview models can have tighter limits. | Needs credentialed smoke and latency data. Also monitor model-name drift because current Google examples and repo defaults may not always name the same Live model generation. | Default for v1. Keep `HVC_GEMINI_MODE=real` and `HVC_GEMINI_MODEL` as the production path until live evidence says otherwise. |
| OpenAI Realtime | Strongest alternate for provider-neutral browser architecture. The [Realtime API guide](https://developers.openai.com/api/docs/guides/realtime) covers voice-agent sessions that receive audio/text and emit model responses, tool calls, and session events. | OpenAI recommends [WebRTC for browser/mobile clients](https://developers.openai.com/api/docs/guides/realtime-webrtc) and supports browser setup through ephemeral API keys or a server-side unified SDP flow. | [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations) document interruption/truncation behavior, push-to-talk patterns, and `response.cancel`/truncate flows. This is likely better specified than Gemini for barge-in, but it would require a transport rewrite. | Token-based model pricing. The [gpt-realtime model page](https://developers.openai.com/api/docs/models/gpt-realtime) and [Realtime cost guide](https://developers.openai.com/api/docs/guides/realtime-costs) document text/audio token billing, prompt caching behavior, and truncation/cost controls. | Switching would move HVC from its existing WebSocket/Gemini token path toward OpenAI WebRTC or a different WebSocket event model. That is real code risk before we have latency proof. | Benchmark as first alternate. Do not switch by docs alone. Consider v1.1 abstraction only if OpenAI wins on browser latency, interruption semantics, or reliability. |
| xAI Grok Voice Agent | Credible new alternate. xAI's [Voice Agent API](https://docs.x.ai/developers/models/voice-agent-api) documents realtime voice conversations over WebSocket, text/audio in and out, function calling, web search, X search, collections, remote MCP tools, and published concurrency/session limits. | xAI documents [ephemeral tokens](https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens) for browsers/mobile apps and browser WebSocket auth via `xai-client-secret.<token>` subprotocol. The [Voice API reference](https://docs.x.ai/developers/rest-api-reference/inference/voice) documents the same client-secret endpoint and WebSocket auth options. | The [Voice Agent guide](https://docs.x.ai/developers/model-capabilities/audio/voice-agent) exposes session updates, model selection, server VAD, tools, and OpenAI Realtime compatibility notes. | Minute-based voice pricing plus text-event pricing. xAI's model page lists audio at `$0.05 / min` and text input at `$0.004` per message as of this snapshot. | Newer surface area, us-east-1 availability, and OpenAI-compatible-but-not-identical event semantics. Needs real browser smoke before trusting compatibility claims. | Benchmark after OpenAI or alongside it if credentials are available. Do not make it v1 default until it proves simpler, cheaper, and at least as safe in HVC's browser path. |
| ElevenLabs Agents | Best managed-agent platform, not the best low-level default for local Hermes control. The [ElevenAgents overview](https://elevenlabs.io/docs/eleven-agents/overview) emphasizes configuring, deploying, monitoring, and optimizing agents across web/mobile/telephony. | ElevenLabs supports direct [WebSocket conversations](https://elevenlabs.io/docs/eleven-agents/libraries/web-sockets). For private agents, the backend should mint a [signed URL](https://elevenlabs.io/docs/eleven-agents/customization/authentication), which the client uses to connect without exposing the API key. | [Tools](https://elevenlabs.io/docs/eleven-agents/customization/tools) include client, server, MCP, and system tools. Client tools can interact with the browser, while server tools can call backend infrastructure. | Subscription/minute model. [ElevenAgents pricing](https://elevenlabs.io/pricing/agents) includes bundled minutes, additional call minutes, text-message pricing, burst pricing, concurrency limits, and separate external LLM/provider costs. | Tool policy and agent configuration would move into a hosted agent resource/dashboard/API. HVC would need a new agent provisioning and webhook/tool bridge story before Hermes safety is as explicit as the current backend-owned allowlist. | Defer for v1. Revisit if product expands to telephony, managed workflows, monitoring/evals, voice catalog quality, or non-Hermes hosted-agent use cases. |

## Live Benchmark Plan

The docs decision is complete, but issue #12's live-evidence bar is not fully
closed until credentials are available.

Run each candidate through the same harness shape:

- Same browser and microphone path.
- Same private network posture: localhost first, Tailscale Serve only with PIN.
- Same assistant instructions: private Hermes voice agent, brief speakable
  answers, no external actions.
- Same tool surface: one read-only `ask_agent` call, one rejected unknown tool,
  one confirmation-only action proposal, and one cancelled long-running tool
  call.
- Same interaction scenarios: connect, first speech response, text fallback,
  barge-in while provider audio is playing, push-to-talk or hold-to-talk,
  reconnection/token expiry, and backend readiness failure.
- Same redaction rules: no API keys, signed URLs, client secrets, conversation
  IDs, PINs, cookies, raw transcripts with private data, or Hermes config in
  committed logs.

Metrics to record:

- Token/client-secret mint latency.
- WebSocket/WebRTC connect latency.
- Time to first assistant audio.
- End-of-user-speech to first assistant audio.
- Barge-in cancellation time.
- Tool-call request latency, backend execution latency, and provider response
  latency after tool output.
- Late-response suppression behavior after cancellation.
- Reconnect behavior after token expiry or session close.
- Per-turn cost estimate from provider usage telemetry.
- Subjective audio quality only after functional safety and latency pass.

Credentials needed before live benchmarking:

- Gemini: `GEMINI_API_KEY` or `GOOGLE_API_KEY` plus `google-genai` installed in
  the server environment.
- OpenAI: `OPENAI_API_KEY` with Realtime model access.
- xAI: `XAI_API_KEY` with Voice Agent API access.
- ElevenLabs: `ELEVENLABS_API_KEY`, an agent ID, and either signed-URL auth or
  an allowlisted localhost/private hostname configuration.

## Follow-Up Decisions

- Issue #12: docs decision artifact is complete; credentialed benchmark
  evidence remains pending. Keep the issue open until at least Gemini and one
  alternate provider have smoke results or the missing alternate credentials
  are explicitly recorded as the blocker.
- Issue #13: provider-neutral adapter work should stay deferred unless the
  benchmark proves a second provider should ship soon. If it starts, define a
  narrow boundary around token minting, connect/disconnect, audio input/output,
  text input, tool-call events, tool responses, cancellation, and usage metrics.
- Issue #17: the latency instrumentation issue should collect provider-neutral
  metrics before any default-provider reversal.
- README/current docs: continue describing Gemini as the default production
  path, but link this artifact so future agents know the default was selected
  from HVC-specific fit, not vendor vibes.
