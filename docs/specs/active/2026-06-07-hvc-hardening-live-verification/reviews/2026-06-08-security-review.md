# Code Review: Issue #15 Security Threat Model Gate

**Date:** 2026-06-08

**Repo:** `/Users/bob/worktrees/hermes-voice-control/feat-security-threat-model-issue-15`

**Files Reviewed:** 8 changed files

**Verdict:** APPROVE

---

## Executive Summary

- Total findings: 0
- Critical: 0
- High: 0
- Medium: 0
- Low: 0
- Top risks:
  - No blocking v1 issue remains after PIN-login and audit-log hardening.
  - External independent review was attempted but not completed because local
    agent-comms/OpenClaw were misconfigured and escalated Claude review was
    rejected to avoid exporting private branch contents without explicit user
    approval.

## Reviewed Threats

| Area | Result |
|---|---|
| Browser compromise | Mitigated for v1 with backend-only long-lived keys, constrained Gemini ephemeral tokens, HttpOnly app session cookies, and no raw session token in PIN JSON. |
| Token theft | Mitigated with authenticated token minting, one-use real Gemini token constraints, short expiry windows, and no token audit logging. |
| PIN/session abuse | Mitigated with strong-PIN fail-closed checks, rate limits, hashed server-side sessions, TTL, revocation, HttpOnly SameSite cookies, and optional Secure cookies. |
| CSRF/origin abuse | Acceptable for v1 because credentialed CORS rejects unknown origins, cookies are SameSite=Lax, browser fetch calls use configured origins, and approval does not execute external actions. Add a CSRF or strict Origin/Referer gate before executable approvals. |
| Reverse-proxy spoofing | Mitigated with localhost bind default, explicit remote-bind override, no-PIN remote/proxy rejection, Host/proxy-header tests, and env validation. |
| Tool prompt injection | Mitigated with backend tool allowlist, argument validation, local Hermes safe toolset, read-only adapter prompt, and non-executing confirmation approvals. |
| Audit-log leakage | Mitigated with default-disabled `/logs`, redaction, response-side session hash hiding, retention pruning, and metadata-only logging for free-text tool traffic. |
| Dependency compromise | Partially mitigated with lockfiles, default mock providers, env gates, direct argv execution for local Hermes, and verification scripts. Run package-manager audit before public release. |
| Accidental public exposure | Mitigated with localhost default, Tailscale Serve guidance instead of Funnel, env validation, and explicit private-network auth requirements. Public internet exposure remains out of scope. |

## Code Hardening Checked

- `/auth/pin` sets the `hvc_session` cookie but does not return the raw session
  token or `session_id` in JSON.
- `ToolService` logs `ask_agent` metadata instead of raw message,
  transcript-window, or agent-answer text.
- Pydantic validation audit entries strip raw `input` values.
- `confirmation.created` logs summary length instead of raw summary text.
- Real Gemini token broker tests assert one-use/model/audio constraints without
  logging provider keys.

## Findings

No critical, high, medium, or low findings.

## Cross-File Impact

- `apps/server/app/main.py` and `apps/web/src/api.ts` now agree that PIN login
  returns safe metadata while the cookie carries the session.
- `apps/server/app/tools.py` and `apps/server/tests/test_backend.py` now share
  the metadata-only audit-log contract for free-text tool traffic.
- `docs/context/security-model.md`, `STATUS.md`, `acceptance-tests.md`, and
  `implementation-map.md` record the same gate and residual risks.

## Security Summary

- A01 Broken Access Control: No new bypass found. Protected endpoints still
  route through `session_dep`; no-PIN remote/proxy guard remains covered.
- A02 Cryptographic Failures: No hardcoded production secret added. Session
  tokens remain random and stored hashed server-side.
- A03 Injection: No shell interpolation added. Local Hermes remains direct argv.
- A05 Security Misconfiguration: Wildcard credentialed CORS and remote bind
  continue to fail closed. Public exposure remains out of scope.
- A07 Identification and Authentication Failures: PIN login no longer returns
  the raw session token in JSON; cookie flags are tested.
- A09 Security Logging and Monitoring Failures: Free-text prompts, transcript
  windows, agent answers, validation inputs, and confirmation summaries are not
  persisted to audit logs.

## Performance / Architecture / Testing Notes

- Performance: Metadata-only logging reduces audit payload size; no hot-path
  loop or query expansion introduced.
- Architecture: Auth, token brokerage, tool routing, and docs remain in their
  existing modules.
- Testing: New backend tests cover cookie-only login, real Gemini token
  constraints, and audit-log leakage regressions.

## Tooling Evidence

- `uv run --extra dev pytest`: 34 passed, 1 existing Starlette/httpx warning.
- `pnpm test`: web 27 passed; backend 34 passed with the same warning.
- `pnpm env:check`: passed with localhost/mock defaults and no warnings.
- `pnpm docs:verify`: passed.
- `tomoji docs index --verify --json`: `inSync: true`.
- `tomoji docs audit --json`: passed with zero findings.
- `pnpm verify`: passed tests, build, performance budget, and docs verify.
- Independent-review tooling: `agent-comms discover` failed on missing
  `commander`; `openclaw agent` failed because the requested `codex` harness is
  not registered; escalated Claude review was rejected because it would export
  private branch contents to an external service without explicit user approval.

## Recommended Fix Order

1. No blocking fixes required for the local review.
2. Get explicit user approval before exporting branch contents to an external
   reviewer, or repair a local-only review agent, if the issue must satisfy a
   strict independent-review interpretation before merge.
3. Add a CSRF token or strict Origin/Referer gate before confirmation approval
   can ever execute an external action.

## Non-Blocking Follow-Ups

- Run a credentialed real Gemini Live smoke test before claiming real-provider
  readiness.
- Run dependency/package-manager audit before public release or long-lived
  deployment.
- Add a per-session CSRF token or strict Origin/Referer gate before any approval
  can execute a real external action.
