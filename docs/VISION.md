# Vision

Hermes Voice Control is a private browser voice surface for Bob/Hermes.

The first product shape is deliberately narrow: a phone or laptop browser talks
to Gemini Live through a local FastAPI broker, and Gemini can call back into a
small backend tool surface that asks local Hermes for read-only answers or
records confirmation-gated action proposals. The browser is convenient, but it
is not trusted with long-lived API keys, Hermes config, or arbitrary local tool
execution.

The repo is not trying to become a public voice-agent platform, a telephony
service, or a generic desktop automation suite. Its job is to make a personal
Hermes/Bob voice loop feel fast, interruptible, inspectable, and safe enough to
use on a private Tailscale network.

## Principles

- Private by default: localhost first, Tailscale Serve only after explicit auth
  hardening, and no Tailscale Funnel/public bind by default.
- Browser untrusted: the backend owns API keys, ephemeral token minting, tool
  allowlists, audit logs, and confirmation state.
- Voice should stay fluid: tap starts or pauses, hold captures a longer thought,
  and holding while Bob speaks is the barge-in gesture.
- Tools stay narrow: `ask_bob` returns speakable read-only answers; risky work
  is represented as a proposal record, not silently executed.
- Mock first, real second: default adapters are deterministic so tests and UI
  work never spend Gemini quota or mutate local state by accident.

## Current Bet

Keep the custom Gemini Live browser path for v1. Borrow proven patterns from
larger open-source voice systems, but avoid a framework migration until HVC
needs multi-user rooms, telephony, provider-neutral pipelines, or hosted agent
workers.
