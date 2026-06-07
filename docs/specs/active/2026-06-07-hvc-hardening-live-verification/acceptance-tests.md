# Acceptance Tests

## Required Before Shipping

- `pnpm test`
- `pnpm build`
- `tomoji docs index --verify`
- `tomoji docs audit`
- Start backend and web app, then run:

```bash
pnpm exec playwright test scripts/browser-responsive.spec.ts --reporter=list
```

- With real Gemini credentials configured on the backend, run:

```bash
node scripts/e2e-real-gemini-live.mjs
```

## Current Evidence

- 2026-06-07: `pnpm test` passed. Web: 4 files / 26 tests. Backend: 21 tests
  with one Starlette/httpx deprecation warning.
- 2026-06-07: `pnpm build` passed.
- 2026-06-07: `tomoji docs index --verify --json` passed with
  `inSync: true`.
- 2026-06-07: `tomoji docs audit --json` passed with zero findings.
- 2026-06-07: backend/web health probes were not running locally, so browser
  responsive and real Gemini smoke were not rerun in this pass.
- 2026-06-07: public repo target selected:
  `https://github.com/elijahmuraoka/hermes-voice-control`.
- 2026-06-07: README screenshots regenerated from local Vite with Chrome
  DevTools Protocol at 390x844 and 1280x900 after the public copy was
  generalized to a configurable Hermes agent.
- 2026-06-07: `git diff --check` passed and README references exactly one
  mobile screenshot plus one desktop screenshot.
- 2026-06-07: `pnpm exec playwright --version` did not find Playwright in the
  current workspace, so the Playwright responsive script remains pending.
