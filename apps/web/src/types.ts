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
export type TranscriptStatus =
  | "draft"
  | "sending"
  | "sent"
  | "streaming"
  | "working"
  | "complete"
  | "needs_permission"
  | "failed"
  | "cancelled";
export interface TranscriptEntry {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  status: TranscriptStatus;
  at: number;
  jobId?: string;
  restored?: boolean;
}
export type ChatJobState =
  | "queued"
  | "thinking"
  | "needs_permission"
  | "complete"
  | "cancelled"
  | "failed";
export interface TextAnswer {
  speakable?: string;
  display?: string;
  mode?: string;
}
export interface TextChatResult {
  request_id?: string;
  status?: string;
  result?: TextAnswer;
}
export interface ChatJobError {
  code?: string | null;
  detail?: string;
  status_code?: number;
}
export interface ChatJobStatus {
  job_id: string;
  request_id?: string;
  state: ChatJobState;
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancelled?: boolean;
  result?: TextChatResult;
  error?: ChatJobError;
}
export type TextChatResponse = TextChatResult | ChatJobStatus;
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
