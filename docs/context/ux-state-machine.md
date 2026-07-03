# UX state machine

Top-level call states:

- `idle`
- `authenticating`
- `connecting`
- `listening`
- `user-speaking`
- `hold-to-talk`
- `agent-thinking`
- `agent-speaking`
- `muted`
- `reconnecting`
- `error`

`agent-thinking` and `agent-speaking` are generic internal state ids. The
visible UI labels use the configured Hermes agent name.

Rules:

- Live mode is the default. It starts the Gemini Live realtime session and
  exposes Live-only controls such as mute and spoken completion notices.
- Basic hold-to-talk is explicit. It records only while the orb is held, shows
  recognized words in the transcript, and submits the final text through
  `/chat/text` background jobs on release.
- Basic hold-to-talk uses the browser speech recognition implementation, so the
  transcript shows a disclosure before the first basic Hold turn.
- Opening transcript never ends the call.
- Focusing text input pauses hands-free capture visually and semantically.
- In Live mode, hold-to-talk interrupts agent speech, starts deterministic
  Gemini capture, and finalizes on pointer release.
- Barge-in cancels in-flight tool calls and suppresses late tool responses for
  the cancelled request id.
- `pointercancel`, active `lostpointercapture`, blur, or visibility loss safely
  finalize or cancel. `lostpointercapture` after a normal release is ignored.
- Reduced-motion replaces looping animation with color, text, and static state changes.
