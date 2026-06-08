import { geminiRealtimeProvider } from "./geminiProvider";
import type {
  RealtimeVoiceProvider,
  RealtimeVoiceProviderId,
  RealtimeVoiceSession,
  RealtimeVoiceSessionOptions,
} from "./types";

export type {
  RealtimeSessionTokenInfo,
  RealtimeToolCall,
  RealtimeToolResponse,
  RealtimeTranscriptEvent,
  RealtimeVoiceCallbacks,
  RealtimeVoiceProvider,
  RealtimeVoiceProviderId,
  RealtimeVoiceSession,
  RealtimeVoiceSessionOptions,
  RealtimeVoiceStatus,
} from "./types";

export const realtimeVoiceProviders: Record<
  RealtimeVoiceProviderId,
  RealtimeVoiceProvider
> = {
  gemini: geminiRealtimeProvider,
};

export const configuredRealtimeProviderId = (
  import.meta.env.VITE_HVC_REALTIME_PROVIDER ?? "gemini"
) as RealtimeVoiceProviderId;

export function createDefaultRealtimeVoiceSession(
  options?: RealtimeVoiceSessionOptions,
): RealtimeVoiceSession {
  const provider = realtimeVoiceProviders[configuredRealtimeProviderId];
  if (!provider) {
    throw new Error(
      `Unsupported realtime provider '${configuredRealtimeProviderId}'.`,
    );
  }
  return provider.createSession(options);
}
