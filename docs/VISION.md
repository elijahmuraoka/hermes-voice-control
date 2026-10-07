# Vision

Hermes Voice Control is a private browser voice surface for a configurable
Hermes agent.

The default entry point is hold-to-talk: the operator holds an orb, speaks, and
the audio travels through a secure backend STT path into the Hermes agent loop.
Gemini Live is an opt-in richer mode — when enabled via a toggle it replaces the
hold-to-talk transport with a realtime audio stream while still routing agent
answers through the same backend tool surface. In both modes the browser is
convenient but untrusted: long-lived API keys, Hermes config, and arbitrary
local tool access stay on the backend.

The initial subprocess bridge was deliberately read-only. The primary API
bridge now delegates to the configured Hermes session and its approval policy;
HVC never auto-answers Hermes approval requests. A phone or laptop is a surface
for the existing agent, not a new agent with the same display name.

The repo is not trying to become a public voice-agent platform, a telephony
service, or a generic desktop automation suite. Its job is to make a personal
Hermes-agent voice loop feel fast, interruptible, inspectable, and safe enough
to use on a private Tailscale network.

## Principles

- Private by default: localhost first, Tailscale Serve only after explicit auth
  hardening, and no Tailscale Funnel/public bind by default.
- Browser untrusted: the backend owns API keys, ephemeral token minting, tool
  allowlists, audit logs, and confirmation state.
- Voice should stay fluid: hold captures a thought in the default push-to-talk
  mode; Live mode adds tap-to-start/pause, continuous listening, and holding
  while the agent speaks as the barge-in gesture.
- Tools stay narrow: HVC exposes a small tool surface. The local subprocess
  fallback remains read-only; Hermes API approvals must be handled on desktop,
  not silently approved by a voice client.
- Mock first, real second: default adapters are deterministic so tests and UI
  work never spend Gemini quota or mutate local state by accident.

## Current Bet

As of 2026-10-07, preserve this client and evaluate upstream Hermes voice
before further broad feature investment. Hold remains the implemented default;
Live is optional. Both modes should speak agent answers, but they use different
voice providers: Hold uses Hermes TTS, while Live uses Gemini audio.

Native Hermes voice and supported external voice surfaces are candidates, not
accepted replacements. Do not retire the current fallback until the intended
phone/laptop workflow, persistent context, permission handling, voice choice,
and private deployment have been demonstrated. See the
[upstream-first decision](decisions/2026-10-07-upstream-first-voice.md) and
[project handoff](context/project-handoff.md) for rationale and remaining gates.
