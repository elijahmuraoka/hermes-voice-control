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

The first product shape is deliberately narrow: a phone or laptop browser broker
connects to a small backend tool surface that asks local Hermes for read-only
answers or records read-only action proposals.

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
- Tools stay narrow: the agent-answer tool returns speakable read-only answers;
  risky work is represented as a proposal record, not silently executed.
- Mock first, real second: default adapters are deterministic so tests and UI
  work never spend Gemini quota or mutate local state by accident.

## Current Bet

Hold-to-talk is the reliable, low-friction default for v1. Keep the custom
Gemini Live browser path as the opt-in richer surface. Borrow proven patterns
from larger open-source voice systems, but avoid a framework migration until HVC
needs multi-user rooms, telephony, provider-neutral pipelines, or hosted agent
workers.
