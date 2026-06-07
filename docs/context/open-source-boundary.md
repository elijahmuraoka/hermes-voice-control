# Open-source boundary

Safe to open-source:

- UI and orb state machine
- backend auth/session/token broker patterns
- mock Gemini/Hermes adapters
- Tailscale-local deployment docs
- tool policy and confirmation queue patterns
- Gemini Live protocol wrapper and test scaffolding, after secret scanning
- generic comparison/research docs

Keep local/private: `.env`, PIN/session secrets, transcript logs, Tailscale hostname, personal prompt/context and memories.

Before pushing to any public remote, run a fresh secret scan and review untracked
review artifacts/screenshots for machine-local paths or personal context.
