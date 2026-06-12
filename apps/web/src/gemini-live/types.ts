import type { GeminiLiveAudio } from "../audio";
import type { HvcDiagnosticsEvent } from "../diagnostics";

export type GeminiLiveStatus =
  | "connecting"
  | "connected"
  | "setup-complete"
  | "listening"
  | "turn-complete"
  | "model-speaking"
  | "interrupted"
  | "closed"
  | "error";

export interface GeminiEphemeralToken {
  token: string;
  expires_at: string;
  mode: string;
  model?: string | null;
}

export interface GeminiTranscriptEvent {
  role: "user" | "model";
  text: string;
  final: boolean;
}

export interface GeminiFunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiFunctionResponse {
  id: string;
  name: string;
  response: Record<string, unknown>;
}

export interface GeminiToolCallContext {
  signal: AbortSignal;
}

export interface GeminiLiveCallbacks {
  onStatus?: (status: GeminiLiveStatus) => void;
  onToken?: (token: Omit<GeminiEphemeralToken, "token">) => void;
  onTranscript?: (event: GeminiTranscriptEvent) => void;
  onToolCall?: (call: GeminiFunctionCall) => void;
  onToolResponse?: (response: GeminiFunctionResponse) => void;
  onDiagnosticsEvent?: (event: HvcDiagnosticsEvent) => void;
  onError?: (error: Error) => void;
  onClose?: (event?: CloseEvent) => void;
}

export interface GeminiLiveAudioConfig {
  startMuted?: boolean;
  holdToTalkOnly?: boolean;
  startCapture?: boolean;
}

export interface GeminiToolDeclaration {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  }>;
}

export interface GeminiLiveSessionOptions {
  model?: string;
  generationConfig?: Record<string, unknown>;
  systemInstruction?: string;
  enableInputTranscription?: boolean;
  enableOutputTranscription?: boolean;
  tools?: GeminiToolDeclaration[];
  audio?: GeminiLiveAudioConfig;
  callbacks?: GeminiLiveCallbacks;
}

export interface LiveWebSocket {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface GeminiLiveDependencies {
  tokenProvider?: () => Promise<GeminiEphemeralToken>;
  toolCaller?: (call: GeminiFunctionCall, context: GeminiToolCallContext) => Promise<unknown>;
  toolCanceler?: (requestIds: string[]) => Promise<unknown>;
  webSocketFactory?: (url: string) => LiveWebSocket;
  audio?: GeminiLiveAudio;
}
