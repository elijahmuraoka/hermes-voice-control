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
