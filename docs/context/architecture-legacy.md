# Architecture Legacy Note

The canonical system architecture is now
[../ARCHITECTURE.md](../ARCHITECTURE.md). This note preserves the original
high-level sketch from the first implementation pass.

## Original Sketch

```text
Phone/laptop browser over Tailscale
  -> React voice UI
  -> backend access check/auth mode
  -> Gemini ephemeral token broker
  -> browser Gemini Live session
  -> Gemini tool call to backend
  -> tool policy + confirmation queue
  -> Bob/Hermes adapter
```

The browser is untrusted. It receives only short-lived Gemini ephemeral tokens
and, when optional PIN auth is enabled, short-lived session state. It never
receives long-lived API keys, Hermes config, or direct tool access.

The backend owns optional app auth, token brokerage, tool allowlist,
confirmation flow, audit logs, and adapter selection. Defaults are
local/Tailscale-first: `127.0.0.1` bind, no PIN requirement, mock Gemini, mock
Hermes, no external action execution on confirmation approval.
