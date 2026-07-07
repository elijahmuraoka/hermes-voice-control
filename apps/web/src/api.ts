import type {
  ChatJobStatus,
  ReadyzResponse,
  SpeechTranscriptionResponse,
  TextChatResponse,
  TranscriptEntry,
  TtsResponse,
} from "./types";
import { apiBase } from "./config";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class ApiRequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const TEXT_JOB_CREATE_TIMEOUT_MS = 15000;
const TEXT_JOB_INTERACTIVE_BUDGET_MS = 750;
const TTS_TIMEOUT_MS = 22000;
export const SPEECH_TRANSCRIPTION_TIMEOUT_MS = 4000;
const textRequestId = () =>
  `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

async function jsonFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  if (!res.ok)
    throw new ApiError(
      (await res.text()).slice(0, 200) || `HTTP ${res.status}`,
      res.status,
    );
  return res.json() as Promise<T>;
}
export async function getSession() {
  const res = await fetch(`${apiBase}/auth/session`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (res.status === 401) return { authenticated: false };
  if (!res.ok)
    throw new ApiError(
      (await res.text()).slice(0, 200) || `HTTP ${res.status}`,
      res.status,
    );
  return { authenticated: true };
}
export async function login(pin: string) {
  return jsonFetch<{ ok: boolean; expires_at: string }>("/auth/pin", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}
export async function getReadyz(): Promise<ReadyzResponse> {
  // /readyz/details carries the checks the connection chip needs but sits
  // behind session auth; unauthenticated /readyz only reports the ok bit.
  const fallback: ReadyzResponse = { ok: false, hasDetails: false };
  const read = async (
    path: string,
    hasDetails: boolean,
  ): Promise<ReadyzResponse | null> => {
    try {
      const res = await fetch(`${apiBase}${path}`, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (res.status === 401)
        return { ok: false, authExpired: true, hasDetails };
      if (res.status === 404) return null;
      const body = (await res.json()) as ReadyzResponse;
      return { ...body, ok: res.ok && body.ok !== false, hasDetails };
    } catch {
      return null;
    }
  };
  const details = await read("/readyz/details", true);
  if (details?.authExpired) return details;
  if (details) return details;
  return (await read("/readyz", false)) ?? fallback;
}
export async function getGeminiToken() {
  return jsonFetch<{
    token: string;
    expires_at: string;
    mode: string;
    model?: string | null;
    voice_name?: string | null;
  }>("/gemini/ephemeral-token", { method: "POST" });
}
export async function cancelTools(requestIds: string[]) {
  return jsonFetch<{ status: string }>("/tools/cancel", {
    method: "POST",
    body: JSON.stringify({ request_ids: requestIds }),
  });
}
export async function sendText(
  message: string,
  transcript: TranscriptEntry[],
  timeoutMs = TEXT_JOB_CREATE_TIMEOUT_MS,
) {
  const requestId = textRequestId();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await jsonFetch<TextChatResponse>("/chat/text", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        request_id: requestId,
        message,
        mode: "quick",
        transcript_window: transcript.slice(-10),
        job: true,
        interactive_budget_ms: TEXT_JOB_INTERACTIVE_BUDGET_MS,
      }),
    });
  } catch (error) {
    if (
      timedOut ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new ApiRequestTimeoutError("Text chat request did not start");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
export async function transcribeSpeechAudio(
  audioChunksBase64: string[],
  fallbackTranscript: string,
  timeoutMs = SPEECH_TRANSCRIPTION_TIMEOUT_MS,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await jsonFetch<SpeechTranscriptionResponse>("/stt/transcribe", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        audio_chunks_base64: audioChunksBase64,
        fallback_transcript: fallbackTranscript,
      }),
    });
  } catch (error) {
    if (
      timedOut ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new ApiRequestTimeoutError("");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
export async function synthesizeSpeech(
  text: string,
  timeoutMs = TTS_TIMEOUT_MS,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await jsonFetch<TtsResponse>("/tts", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({ text }),
    });
  } catch (error) {
    if (
      timedOut ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new ApiRequestTimeoutError("Voice playback request timed out");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
export async function getTextJob(jobId: string) {
  return jsonFetch<ChatJobStatus>(`/chat/jobs/${encodeURIComponent(jobId)}`);
}
export async function cancelTextJob(jobId: string) {
  return jsonFetch<ChatJobStatus>(
    `/chat/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
  );
}
export async function getLogs() {
  return jsonFetch<{ items: unknown[] }>("/logs");
}
