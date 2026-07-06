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

- Basic hold-to-talk is the default. It records only while the orb is held,
  shows browser-recognized interim words in the transcript, finalizes through
  backend STT when configured, and submits the final text through `/chat/text`
  background jobs on release.
- Basic hold-to-talk shows a one-time disclosure before the first held turn,
  including the default mode path. The disclosure must name the configured
  transcription provider; Gemini STT means held audio is sent to Google Gemini
  through the authenticated backend.
- Basic hold-to-talk caps STT upload audio at roughly 60 seconds. When the cap
  trips, the transcript shows a lightweight notice and sends the browser text
  immediately on release instead of uploading audio that will be discarded.
- Basic hold-to-talk keeps the finalizing state visible while backend STT runs.
  The timeout scales with captured audio duration and falls back to browser text
  rather than stranding the turn.
- Live mode starts the Gemini Live realtime session and exposes Live-only
  controls such as mute and spoken completion notices.
- Opening transcript never ends the call.
- Focusing text input pauses hands-free capture visually and semantically.
- In Live mode, hold-to-talk interrupts agent speech, starts deterministic
  Gemini capture, and finalizes on pointer release.
- Barge-in cancels in-flight tool calls and suppresses late tool responses for
  the cancelled request id.
- `pointercancel`, active `lostpointercapture`, blur, or visibility loss safely
  finalize or cancel. `lostpointercapture` after a normal release is ignored.
- Reduced-motion replaces looping animation with color, text, and static state changes.
