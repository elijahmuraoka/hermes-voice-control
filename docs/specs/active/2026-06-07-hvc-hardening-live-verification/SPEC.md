---
name: 2026-06-07-hvc-hardening-live-verification
status: active
started: '2026-06-07'
description: >-
  Harden Hermes Voice Control for private Gemini Live use and document current
  verification
owner:
  - Codex
tags:
  - hvc
  - voice
---
# 2026-06-07-hvc-hardening-live-verification

## What

This spec tracks the current HVC hardening pass: private access boundaries,
Gemini Live protocol fixes, cancellable tool calls, local Hermes adapter safety,
mobile responsive behavior, real-smoke scripts, and documentation cleanup under
the `doc-maintenance` structure.

## Why

The earlier review passes found blockers that would make HVC unsafe or brittle
as a real private voice prototype: no-PIN Tailscale exposure, Gemini Live setup
shape, incomplete audio finalization, local Hermes launch failure handling, and
small-screen overlap. The repo also lacked a maintained doc structure and has
no remote configured, so the source of truth is still local.

## Scope

In scope:

- Keep localhost-first defaults and require explicit auth for Tailscale Serve.
- Normalize Gemini model resource names and finalize microphone audio with
  `audioStreamEnd`.
- Add request-id based tool cancellation from frontend to backend.
- Keep Hermes integration read-only and safe by default.
- Preserve and update implementation/security/docs context.
- Capture current verification and remaining live-smoke gaps.

Out of scope:

- Public network exposure or Tailscale Funnel.
- Telephony support.
- Framework migration to LiveKit, Pipecat, Vocode, or another voice stack.
- Confirmation-approved external action execution.

## Success criteria

- `pnpm test` passes.
- `pnpm build` passes.
- `tomoji docs index --verify` passes.
- `tomoji docs audit` has no critical or warning findings.
- Browser responsive smoke passes at 320/390/768/1280 after app/server startup.
- Real Gemini Live smoke passes with `HVC_GEMINI_MODE=real`.
- A remote is configured and the repo is pushed, or the missing remote decision
  is explicitly recorded as the only push blocker.
