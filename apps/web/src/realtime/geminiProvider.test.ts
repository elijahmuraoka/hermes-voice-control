import { describe, expect, it } from "vitest";
import {
  toRealtimeTranscriptEvent,
  toRealtimeVoiceStatus,
} from "./geminiProvider";

describe("gemini realtime provider adapter", () => {
  it("maps provider status into the app realtime contract", () => {
    expect(toRealtimeVoiceStatus("model-speaking")).toBe("agent-speaking");
    expect(toRealtimeVoiceStatus("listening")).toBe("listening");
    expect(toRealtimeVoiceStatus("turn-complete")).toBe("turn-complete");
  });

  it("maps Gemini model transcripts to agent transcripts", () => {
    expect(
      toRealtimeTranscriptEvent({
        role: "model",
        text: "hello",
        final: true,
      }),
    ).toEqual({ role: "agent", text: "hello", final: true });
    expect(
      toRealtimeTranscriptEvent({
        role: "user",
        text: "hi",
        final: false,
      }),
    ).toEqual({ role: "user", text: "hi", final: false });
  });
});
