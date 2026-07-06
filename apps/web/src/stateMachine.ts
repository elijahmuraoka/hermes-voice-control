import type { VoiceEvent, VoiceState } from "./types";
export const initialVoiceState: VoiceState = {
  callState: "idle",
  inputMode: "hands-free",
  drawer: "peeking",
  isMuted: false,
  partialTranscript: "",
};
export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case "TAP":
      if (state.inputMode === "text") return state;
      if (
        state.callState === "listening" ||
        state.callState === "user-speaking"
      )
        return { ...state, callState: "paused", inputMode: "hands-free" };
      if (state.callState === "paused")
        return {
          ...state,
          callState: state.isMuted ? "muted" : "listening",
          inputMode: "hands-free",
          error: undefined,
        };
      return state;
    case "CONNECT":
      return { ...state, callState: "connecting", error: undefined };
    case "CONNECTED":
      return {
        ...state,
        callState: state.isMuted ? "muted" : "listening",
        inputMode: "hands-free",
        reconnectAttempt: undefined,
        error: undefined,
      };
    case "START_LISTENING":
      return { ...state, callState: "listening", inputMode: "hands-free" };
    case "PAUSE":
      return { ...state, callState: "paused", inputMode: "hands-free" };
    case "RESUME":
      return {
        ...state,
        callState: state.isMuted ? "muted" : "listening",
        inputMode: "hands-free",
        error: undefined,
      };
    case "SPEECH_START":
      return { ...state, callState: "user-speaking" };
    case "POINTER_DOWN":
      if (state.inputMode === "text" || state.callState === "connecting")
        return state;
      return {
        ...state,
        callState: "hold-to-talk",
        inputMode: "hold-to-talk",
        isMuted: false,
        error: undefined,
      };
    case "POINTER_UP":
      if (state.callState !== "hold-to-talk") return state;
      return { ...state, callState: "agent-thinking", inputMode: "hands-free" };
    case "FINALIZE":
      if (state.callState !== "hold-to-talk") return state;
      return { ...state, callState: "finalizing", inputMode: "hands-free" };
    case "POINTER_CANCEL":
      if (state.callState !== "hold-to-talk") return state;
      return {
        ...state,
        callState: state.partialTranscript ? "agent-thinking" : "listening",
        inputMode: "hands-free",
      };
    case "THINK":
      return { ...state, callState: "agent-thinking", reconnectAttempt: undefined };
    case "SPEAK":
      return { ...state, callState: "agent-speaking" };
    case "DONE":
      return {
        ...state,
        callState: state.isMuted ? "muted" : "listening",
        inputMode: "hands-free",
      };
    case "MUTE":
      return {
        ...state,
        isMuted: true,
        callState: "muted",
        inputMode: "hands-free",
      };
    case "UNMUTE":
      return {
        ...state,
        isMuted: false,
        callState: "listening",
        inputMode: "hands-free",
      };
    case "INTERRUPT":
      return { ...state, callState: "listening", inputMode: "hands-free" };
    case "ERROR":
      return {
        ...state,
        callState: "error",
        error: event.error,
        reconnectAttempt: undefined,
      };
    case "RECONNECT":
      return {
        ...state,
        callState: "reconnecting",
        inputMode: "hands-free",
        reconnectAttempt: event.attempt,
        error: undefined,
      };
    case "RECOVER":
      return {
        ...state,
        callState: "idle",
        inputMode: "hands-free",
        error: undefined,
        reconnectAttempt: undefined,
      };
    case "SET_DRAWER":
      return { ...state, drawer: event.drawer };
    case "FOCUS_TEXT":
      return {
        ...state,
        inputMode: "text",
        callState: [
          "listening",
          "user-speaking",
          "hold-to-talk",
          "finalizing",
          "agent-thinking",
          "reconnecting",
        ].includes(state.callState)
          ? "idle"
          : state.callState,
      };
    case "BLUR_TEXT":
      return { ...state, inputMode: "hands-free" };
    default:
      return state;
  }
}
export function stateLabel(state: VoiceState, agentName = "Hermes Agent"): string {
  const labels: Record<string, string> = {
    idle: `Tap to talk to ${agentName}`,
    connecting: "Connecting voice...",
    listening: "Listening hands-free",
    paused: "Paused",
    "user-speaking": "Hearing you",
    "hold-to-talk": "Holding to talk",
    "agent-thinking": "Finishing your turn...",
    finalizing: "Finalizing...",
    "agent-speaking": `${agentName} is speaking`,
    muted: "Mic paused",
    reconnecting: state.reconnectAttempt
      ? `Reconnecting... attempt ${state.reconnectAttempt}`
      : "Reconnecting...",
    error: state.error || "Something needs attention",
  };
  return labels[state.callState] || state.callState;
}
