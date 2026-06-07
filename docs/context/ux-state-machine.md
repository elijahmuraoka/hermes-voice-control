# UX state machine

Top-level call states:

- `idle`
- `authenticating`
- `connecting`
- `listening`
- `user-speaking`
- `hold-to-talk`
- `bob-thinking`
- `bob-speaking`
- `muted`
- `reconnecting`
- `error`

Rules:

- Opening transcript never ends the call.
- Focusing text input pauses hands-free capture visually and semantically.
- Hold-to-talk interrupts Bob speaking, starts deterministic capture, and finalizes on pointer release.
- Barge-in cancels in-flight tool calls and suppresses late tool responses for
  the cancelled request id.
- `pointercancel`, `lostpointercapture`, blur, or visibility loss safely finalize or cancel.
- Reduced-motion replaces looping animation with color, text, and static state changes.
