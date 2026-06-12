import {
  GeminiLiveSession,
  type GeminiLiveCallbacks,
  type GeminiLiveStatus,
  type GeminiTranscriptEvent,
} from "../geminiLive";
import type {
  RealtimeTranscriptEvent,
  RealtimeVoiceProvider,
  RealtimeVoiceSession,
  RealtimeVoiceSessionOptions,
  RealtimeVoiceStatus,
} from "./types";

const PROVIDER_ID = "gemini";

export function toRealtimeVoiceStatus(
  status: GeminiLiveStatus,
): RealtimeVoiceStatus {
  return status === "model-speaking" ? "agent-speaking" : status;
}

export function toRealtimeTranscriptEvent(
  event: GeminiTranscriptEvent,
): RealtimeTranscriptEvent {
  return {
    role: event.role === "model" ? "agent" : "user",
    text: event.text,
    final: event.final,
  };
}

class GeminiRealtimeVoiceSession implements RealtimeVoiceSession {
  private readonly session: GeminiLiveSession;

  constructor(options: RealtimeVoiceSessionOptions = {}) {
    const callbacks = toGeminiCallbacks(options.callbacks);
    this.session = new GeminiLiveSession({
      callbacks,
      audio: options.audio,
    });
  }

  connect(): Promise<void> {
    return this.session.connect();
  }

  resume(): void {
    this.session.resume();
  }

  interrupt(): void {
    this.session.interrupt();
  }

  abandonPendingResponse(): void {
    this.session.abandonPendingResponse();
  }

  finalizeInputTurn(): boolean {
    return this.session.finalizeInputTurn();
  }

  setHoldToTalk(active: boolean): void {
    this.session.setHoldToTalk(active);
  }

  setMicrophoneEnabled(enabled: boolean): void {
    this.session.setMicrophoneEnabled(enabled);
  }

  disconnect(): void {
    this.session.disconnect();
  }
}

function toGeminiCallbacks(
  callbacks: RealtimeVoiceSessionOptions["callbacks"],
): GeminiLiveCallbacks {
  return {
    onStatus: (status) => callbacks?.onStatus?.(toRealtimeVoiceStatus(status)),
    onToken: (token) =>
      callbacks?.onToken?.({
        expires_at: token.expires_at,
        mode: token.mode,
        model: token.model,
        provider: PROVIDER_ID,
      }),
    onTranscript: (event) =>
      callbacks?.onTranscript?.(toRealtimeTranscriptEvent(event)),
    onToolCall: callbacks?.onToolCall,
    onToolResponse: callbacks?.onToolResponse,
    onDiagnosticsEvent: callbacks?.onDiagnosticsEvent,
    onError: callbacks?.onError,
    onClose: callbacks?.onClose,
  };
}

export const geminiRealtimeProvider: RealtimeVoiceProvider = {
  id: PROVIDER_ID,
  label: "Gemini Live",
  createSession(options) {
    return new GeminiRealtimeVoiceSession(options);
  },
};
