# Backend chat job contract

Issue #47 adds an opt-in lifecycle for text chat without changing the default
`POST /chat/text` behavior.

## Opt in

Clients opt in with either request body field:

```json
{
  "request_id": "client-generated-id",
  "message": "Hello",
  "mode": "quick",
  "job": true,
  "interactive_budget_ms": 750
}
```

or header:

```text
X-HVC-Chat-Job: 1
X-HVC-Chat-Budget-Ms: 750
```

`interactive_budget_ms` is optional. The server default is
`HVC_CHAT_JOB_INTERACTIVE_BUDGET_MS` or 750 ms, bounded to 0-30000 ms.

## Fast path

If Hermes finishes inside the interactive budget, `/chat/text` returns the
normal synchronous chat response body:

```json
{
  "status": "completed",
  "result": {
    "speakable": "Answer text",
    "display": "Answer text",
    "mode": "quick"
  },
  "request_id": "client-generated-id"
}
```

The response also includes `X-HVC-Chat-Job-Id` so a client can inspect the
session-scoped persisted job record if needed.

## Slow path

If Hermes is still running when the interactive budget expires, `/chat/text`
returns `202 Accepted`:

```json
{
  "job_id": "server-generated-id",
  "request_id": "client-generated-id",
  "state": "thinking",
  "created_at": "2026-06-26T00:00:00+00:00",
  "updated_at": "2026-06-26T00:00:00+00:00",
  "started_at": "2026-06-26T00:00:00+00:00",
  "completed_at": null,
  "cancelled_at": null,
  "cancelled": false
}
```

Headers:

```text
Location: /chat/jobs/{job_id}
X-HVC-Chat-Job-Id: {job_id}
```

## Status

`GET /chat/jobs/{job_id}` returns the job only for the authenticated session
that created it. Cross-session lookups return 404.

States:

- `queued`
- `thinking`
- `needs_permission`
- `complete`
- `cancelled`
- `failed`

`complete` and `needs_permission` include a `result` field. `failed` includes a
safe `error` object with `status_code`, `detail`, and `code`.

## Cancel

`POST /chat/jobs/{job_id}/cancel` marks the job cancelled and inserts the
job's internal tool request key into the existing tool cancellation table.
Running local Hermes calls observe that through the adapter `should_cancel` hook
and terminate the subprocess when possible.

The public `request_id` remains the client-facing id in job status and completed
responses. Internally, each job uses a per-job cancellation key derived from
`job_id` so cancelling one default `text-chat` job does not cancel other
in-flight jobs or poison later default text chat calls.

## Persistence and redaction

SQLite persists `job_id`, `session_hash`, `request_id`, state, timestamps,
cancellation status, and safe result/error metadata. It does not persist raw
prompt text, transcript windows, PINs, cookies, or tokens. Completed final
result text may be stored only as the session-scoped result that the
authenticated UI needs after refresh. When explicitly requested with
`X-HVC-Adapter-Diagnostics`, chat job status may also retain the same redacted
adapter timing diagnostics as the synchronous text path so private live
verification can distinguish queue/poll latency from Hermes execution latency.
