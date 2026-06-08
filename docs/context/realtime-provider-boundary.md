# Realtime Provider Boundary

Hermes Voice Control keeps Gemini Live as the v1 realtime provider, but the
React app talks to a provider-neutral boundary in `apps/web/src/realtime/`.
That boundary is deliberately small: it creates a voice session, emits generic
voice statuses, returns transcript events as `user` or `agent`, and forwards
tool-call events without exposing provider protocol details to the UI.

## Current Provider

`apps/web/src/realtime/geminiProvider.ts` adapts the existing
`GeminiLiveSession` into the generic contract. It maps provider-specific
`model-speaking` status to `agent-speaking` and maps Gemini `model` transcript
roles to app-level `agent` roles.

`VITE_HVC_REALTIME_PROVIDER` defaults to `gemini`. Unsupported provider ids fail
closed at session creation time.

## Adding A Provider

Add a provider only after benchmark evidence shows that another provider should
ship soon. A provider implementation should:

- implement `RealtimeVoiceProvider` from `apps/web/src/realtime/types.ts`
- translate provider statuses into `RealtimeVoiceStatus`
- translate provider transcript roles into `user` or `agent`
- keep provider websocket/WebRTC/event parsing inside a provider-named module
- keep backend tool policy and cancellation semantics unchanged
- add focused adapter tests plus app smoke coverage

Do not place long-lived provider API keys in frontend env vars. Browser
providers must use a backend-minted ephemeral credential, signed URL, or
server-side session creation endpoint. The backend remains responsible for
provider authentication, tool allowlists, and Hermes access policy.

## Disabling A Provider

Remove it from the `realtimeVoiceProviders` registry and stop advertising the
id in deployment configuration. The app should not fall back silently from an
unknown provider id, because silent fallback can mask misconfigured private
deployments.
