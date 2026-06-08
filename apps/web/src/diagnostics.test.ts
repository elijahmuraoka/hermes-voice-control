import { describe, expect, it } from "vitest";
import {
  createHvcDiagnosticsRecorder,
  redactDiagnosticText,
  summarizeDiagnostics,
  type HvcDiagnosticsEvent,
} from "./diagnostics";

describe("diagnostics", () => {
  it("summarizes provider, audio, tool, cancellation, and close latencies", () => {
    const events: HvcDiagnosticsEvent[] = [
      { name: "session_start", epochMs: 1000, monotonicMs: 10 },
      { name: "mic_start", epochMs: 1050, monotonicMs: 60 },
      {
        name: "provider_response_first",
        epochMs: 1120,
        monotonicMs: 130,
      },
      {
        name: "tool_call_request",
        epochMs: 1130,
        monotonicMs: 140,
        detail: { toolCallSeq: 1, toolName: "ask_agent" },
      },
      {
        name: "tool_call_response",
        epochMs: 1180,
        monotonicMs: 190,
        detail: { toolCallSeq: 1, toolName: "ask_agent" },
      },
      {
        name: "tool_call_cancellation",
        epochMs: 1190,
        monotonicMs: 200,
        detail: { toolCallSeqs: [2, 3], count: 2 },
      },
      { name: "session_resume", epochMs: 1195, monotonicMs: 205 },
      {
        name: "audio_playback_first",
        epochMs: 1210,
        monotonicMs: 220,
      },
      {
        name: "provider_response_first",
        epochMs: 1220,
        monotonicMs: 230,
      },
      { name: "session_resume", epochMs: 1230, monotonicMs: 240 },
      {
        name: "provider_response_first",
        epochMs: 1270,
        monotonicMs: 280,
      },
      { name: "session_close", epochMs: 1300, monotonicMs: 310 },
    ];

    expect(summarizeDiagnostics(events)).toEqual({
      firstProviderResponseLatencyMs: 120,
      firstAudioPlaybackLatencyMs: 210,
      resumeLatencyMs: 40,
      sessionClosedAtMs: 300,
      cancellationCount: 2,
      toolCalls: [
        {
          toolCallSeq: 1,
          toolName: "ask_agent",
          requestAtMs: 140,
          responseAtMs: 190,
          latencyMs: 50,
        },
        { toolCallSeq: 2, cancelledAtMs: 200 },
        { toolCallSeq: 3, cancelledAtMs: 200 },
      ],
    });
  });

  it("redacts tokens, secrets, and session identifiers from diagnostic text", () => {
    const text =
      'Authorization=Bearer abc.def.ghi Authorization=Basic dXNlcjpwYXNz hvc_session=abc123456789 foo_session=sess_prefixed_123456789 x-session-key=keyed-session-token token=raw-secret access_token=access-secret refresh_token=refresh-secret id-token=id-secret client_secret=client-secret-value oauth_client_secret=oauth-secret-value clientSecret=camel-secret-value refreshToken=camel-refresh-value session_id=sess_123456789 sessions/sess_path_123456789 bare=sess_bare_123456789 api_key=key GOOGLE_API_KEY=google-secret GEMINI_API_KEY: gemini-secret OPENAI_API_KEY = "openai-secret" googleApiKey=camel-api-secret Authorization: Basic dXNlcjpwYXNz\nCookie: foo=bar; other=baz\ncookie=client=secret; theme=blue {"token":"json-secret","access_token":"json-access","refreshToken":"json-refresh","client_secret":"json-client-secret","clientSecret":"json-camel-secret","session_id":"sess_json_123456789","GOOGLE_API_KEY":"json-google-secret","gemini_api_key":"json-gemini-secret","openaiApiKey":"json-openai-secret"}';

    const redacted = redactDiagnosticText(text);

    expect(redacted).toContain("Authorization=[redacted]");
    expect(redacted).toContain("hvc_session=[redacted]");
    expect(redacted).toContain("foo_session=[redacted]");
    expect(redacted).toContain("x-session-key=[redacted]");
    expect(redacted).toContain("token=[redacted]");
    expect(redacted).toContain("access_token=[redacted]");
    expect(redacted).toContain("refresh_token=[redacted]");
    expect(redacted).toContain("id-token=[redacted]");
    expect(redacted).toContain("client_secret=[redacted]");
    expect(redacted).toContain("oauth_client_secret=[redacted]");
    expect(redacted).toContain("clientSecret=[redacted]");
    expect(redacted).toContain("refreshToken=[redacted]");
    expect(redacted).toContain("session_id=[redacted]");
    expect(redacted).toContain("sessions/[redacted]");
    expect(redacted).toContain("bare=[redacted-session]");
    expect(redacted).toContain("api_key=[redacted]");
    expect(redacted).toContain("GOOGLE_API_KEY=[redacted]");
    expect(redacted).toContain("GEMINI_API_KEY: [redacted]");
    expect(redacted).toContain("OPENAI_API_KEY = [redacted]");
    expect(redacted).toContain("googleApiKey=[redacted]");
    expect(redacted).toContain("Authorization: [redacted]");
    expect(redacted).toContain("Cookie: [redacted]");
    expect(redacted).toContain("cookie=[redacted]");
    expect(redacted).not.toContain("raw-secret");
    expect(redacted).not.toContain("abc123456789");
    expect(redacted).not.toContain("sess_prefixed_123456789");
    expect(redacted).not.toContain("keyed-session-token");
    expect(redacted).not.toContain("access-secret");
    expect(redacted).not.toContain("refresh-secret");
    expect(redacted).not.toContain("id-secret");
    expect(redacted).not.toContain("client-secret-value");
    expect(redacted).not.toContain("oauth-secret-value");
    expect(redacted).not.toContain("camel-secret-value");
    expect(redacted).not.toContain("camel-refresh-value");
    expect(redacted).not.toContain("dXNlcjpwYXNz");
    expect(redacted).not.toContain("foo=bar");
    expect(redacted).not.toContain("other=baz");
    expect(redacted).not.toContain("client=secret");
    expect(redacted).not.toContain("theme=blue");
    expect(redacted).not.toContain("sess_123456789");
    expect(redacted).not.toContain("sess_bare_123456789");
    expect(redacted).not.toContain("google-secret");
    expect(redacted).not.toContain("gemini-secret");
    expect(redacted).not.toContain("openai-secret");
    expect(redacted).not.toContain("camel-api-secret");
    expect(redacted).not.toContain("json-secret");
    expect(redacted).not.toContain("json-access");
    expect(redacted).not.toContain("json-refresh");
    expect(redacted).not.toContain("json-client-secret");
    expect(redacted).not.toContain("json-camel-secret");
    expect(redacted).not.toContain("sess_json_123456789");
    expect(redacted).not.toContain("json-google-secret");
    expect(redacted).not.toContain("json-gemini-secret");
    expect(redacted).not.toContain("json-openai-secret");
  });

  it("keeps the copyable diagnostics bundle local and redacted", () => {
    const recorder = createHvcDiagnosticsRecorder();
    recorder.startSession();
    recorder.mark("provider_response_first", {
      closeReason: "session_id=sess_123 token=secret clientSecret=raw-client-secret",
      token: "raw-secret",
      client_secret: "structured-client-secret",
      clientSecret: "structured-camel-secret",
      session_id: "sess_456",
    });

    const bundle = recorder.copyText();
    const snapshot = recorder.snapshot();

    expect(snapshot.privacy.localOnly).toBe(true);
    expect(snapshot.privacy.redacted).toBe(true);
    expect(snapshot.budgets.firstAudioLatencyMs).toBeGreaterThan(0);
    expect(bundle).toContain("[redacted]");
    expect(bundle).not.toContain("token=secret");
    expect(bundle).not.toContain("raw-client-secret");
    expect(bundle).not.toContain("raw-secret");
    expect(bundle).not.toContain("structured-client-secret");
    expect(bundle).not.toContain("structured-camel-secret");
    expect(bundle).not.toContain("sess_123");
    expect(bundle).not.toContain("sess_456");
  });
});
