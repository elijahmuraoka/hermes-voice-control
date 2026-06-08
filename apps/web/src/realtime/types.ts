import type { HvcDiagnosticsEvent } from "../diagnostics";

export type RealtimeVoiceProviderId = "gemini";

export type RealtimeVoiceStatus =
  | "connecting"
  | "connected"
  | "setup-complete"
  | "listening"
  | "agent-speaking"
  | "interrupted"
  | "closed"
  | "error";

export interface RealtimeSessionTokenInfo {
  expires_at: string;
  mode: string;
  model?: string | null;
  provider: RealtimeVoiceProviderId;
}

export interface RealtimeTranscriptEvent {
  role: "user" | "agent";
  text: string;
  final: boolean;
}

export interface RealtimeToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface RealtimeToolResponse {
  id: string;
  name: string;
  response: Record<string, unknown>;
}

export interface RealtimeVoiceCallbacks {
  onStatus?: (status: RealtimeVoiceStatus) => void;
  onToken?: (token: RealtimeSessionTokenInfo) => void;
  onTranscript?: (event: RealtimeTranscriptEvent) => void;
  onToolCall?: (call: RealtimeToolCall) => void;
  onToolResponse?: (response: RealtimeToolResponse) => void;
  onDiagnosticsEvent?: (event: HvcDiagnosticsEvent) => void;
  onError?: (error: Error) => void;
  onClose?: (event?: CloseEvent) => void;
}

export interface RealtimeVoiceAudioConfig {
  startMuted?: boolean;
  holdToTalkOnly?: boolean;
  startCapture?: boolean;
}

export interface RealtimeVoiceSessionOptions {
  callbacks?: RealtimeVoiceCallbacks;
  audio?: RealtimeVoiceAudioConfig;
}

export interface RealtimeVoiceSession {
  connect(): Promise<void>;
  resume(): void;
  interrupt(): void;
  setHoldToTalk(active: boolean): void;
  setMicrophoneEnabled(enabled: boolean): void;
  disconnect(): void;
}

export interface RealtimeVoiceProvider {
  id: RealtimeVoiceProviderId;
  label: string;
  createSession(options?: RealtimeVoiceSessionOptions): RealtimeVoiceSession;
}
