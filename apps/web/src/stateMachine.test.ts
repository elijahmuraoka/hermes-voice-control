import { describe, expect, it } from "vitest";
import { initialVoiceState, voiceReducer } from "./stateMachine";

describe("voiceReducer", () => {
  it("moves through connect/listening without auth gates", () => {
    let s = voiceReducer(initialVoiceState, { type: "CONNECT" });
    expect(s.callState).toBe("connecting");
    s = voiceReducer(s, { type: "CONNECTED" });
    expect(s.callState).toBe("listening");
  });
  it("tap pauses and resumes the hot mic", () => {
    let s = voiceReducer(
      { ...initialVoiceState, callState: "listening" },
      { type: "TAP" },
    );
    expect(s.callState).toBe("paused");
    s = voiceReducer(s, { type: "TAP" });
    expect(s.callState).toBe("listening");
  });
  it("supports hold-to-talk release and cancel", () => {
    let s = voiceReducer(
      { ...initialVoiceState, callState: "listening" },
      { type: "POINTER_DOWN" },
    );
    expect(s.callState).toBe("hold-to-talk");
    s = voiceReducer(s, { type: "POINTER_UP" });
    expect(s.callState).toBe("bob-thinking");
    s = voiceReducer(s, { type: "DONE" });
    expect(s.callState).toBe("listening");
    s = voiceReducer(s, { type: "POINTER_DOWN" });
    s = voiceReducer(s, { type: "POINTER_CANCEL" });
    expect(s.callState).toBe("listening");
  });
  it("focus text moves to text mode and drops listening states to idle", () => {
    const s = voiceReducer(
      { ...initialVoiceState, callState: "user-speaking" },
      { type: "FOCUS_TEXT" },
    );
    expect(s.inputMode).toBe("text");
    expect(s.callState).toBe("idle");
  });
});
