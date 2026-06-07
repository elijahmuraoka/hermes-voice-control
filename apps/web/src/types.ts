export type CallState =
  | "idle"
  | "connecting"
  | "listening"
  | "paused"
  | "user-speaking"
  | "hold-to-talk"
  | "agent-thinking"
  | "agent-speaking"
  | "muted"
  | "reconnecting"
  | "error";
export type InputMode = "hands-free" | "hold-to-talk" | "text";
export type DrawerState = "closed" | "peeking" | "open";
export interface TranscriptEntry {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  status:
    | "draft"
    | "sending"
    | "sent"
    | "streaming"
    | "complete"
    | "failed"
    | "cancelled";
  at: number;
}
export interface VoiceState {
  callState: CallState;
  inputMode: InputMode;
  drawer: DrawerState;
  isMuted: boolean;
  partialTranscript: string;
  error?: string;
}
export type VoiceEvent =
  | { type: "TAP" }
  | { type: "CONNECT" }
  | { type: "CONNECTED" }
  | { type: "START_LISTENING" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "SPEECH_START" }
  | { type: "POINTER_DOWN" }
  | { type: "POINTER_UP" }
  | { type: "POINTER_CANCEL" }
  | { type: "THINK" }
  | { type: "SPEAK" }
  | { type: "DONE" }
  | { type: "MUTE" }
  | { type: "UNMUTE" }
  | { type: "INTERRUPT" }
  | { type: "ERROR"; error: string }
  | { type: "RECOVER" }
  | { type: "SET_DRAWER"; drawer: DrawerState }
  | { type: "FOCUS_TEXT" }
  | { type: "BLUR_TEXT" };
