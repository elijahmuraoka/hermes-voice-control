import type { TranscriptEntry } from "./types";
import { apiBase } from "./config";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class ApiTimeoutError extends Error {
  constructor(
    message: string,
    readonly requestId: string,
  ) {
    super(message);
  }
}

const TEXT_FALLBACK_TIMEOUT_MS = 15000;
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
export async function getGeminiToken() {
  return jsonFetch<{
    token: string;
    expires_at: string;
    mode: string;
    model?: string | null;
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
  timeoutMs = TEXT_FALLBACK_TIMEOUT_MS,
) {
  const requestId = textRequestId();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await jsonFetch<{
      status: string;
      result: { speakable: string; display: string };
    }>("/chat/text", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        request_id: requestId,
        message,
        mode: "quick",
        transcript_window: transcript.slice(-10),
      }),
    });
  } catch (error) {
    if (timedOut || (error instanceof DOMException && error.name === "AbortError")) {
      void cancelTools([requestId]).catch(() => undefined);
      throw new ApiTimeoutError("Text fallback timed out", requestId);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
export async function getLogs() {
  return jsonFetch<{ items: unknown[] }>("/logs");
}
