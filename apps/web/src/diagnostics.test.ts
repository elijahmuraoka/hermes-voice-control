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
      { name: "session_close", epochMs: 1300, monotonicMs: 310 },
    ];

    expect(summarizeDiagnostics(events)).toEqual({
      firstProviderResponseLatencyMs: 120,
      firstAudioPlaybackLatencyMs: 210,
      resumeLatencyMs: 25,
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
      'Authorization=Bearer abc.def.ghi token=raw-secret session_id=sess_123456789 sessions/sess_path_123456789 api_key=key {"token":"json-secret","session_id":"sess_json_123456789"}';

    const redacted = redactDiagnosticText(text);

    expect(redacted).toContain("Authorization=[redacted]");
    expect(redacted).toContain("token=[redacted]");
    expect(redacted).toContain("session_id=[redacted]");
    expect(redacted).toContain("sessions/[redacted]");
    expect(redacted).toContain("api_key=[redacted]");
    expect(redacted).not.toContain("raw-secret");
    expect(redacted).not.toContain("sess_123456789");
    expect(redacted).not.toContain("json-secret");
    expect(redacted).not.toContain("sess_json_123456789");
  });

  it("keeps the copyable diagnostics bundle local and redacted", () => {
    const recorder = createHvcDiagnosticsRecorder();
    recorder.startSession();
    recorder.mark("provider_response_first", {
      closeReason: "session_id=sess_123 token=secret",
      token: "raw-secret",
      session_id: "sess_456",
    });

    const bundle = recorder.copyText();
    const snapshot = recorder.snapshot();

    expect(snapshot.privacy.localOnly).toBe(true);
    expect(snapshot.privacy.redacted).toBe(true);
    expect(snapshot.budgets.firstAudioLatencyMs).toBeGreaterThan(0);
    expect(bundle).toContain("[redacted]");
    expect(bundle).not.toContain("token=secret");
    expect(bundle).not.toContain("raw-secret");
    expect(bundle).not.toContain("sess_123");
    expect(bundle).not.toContain("sess_456");
  });
});
