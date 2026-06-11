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
export async function sendText(message: string, transcript: TranscriptEntry[]) {
  return jsonFetch<{
    status: string;
    result: { speakable: string; display: string };
  }>("/chat/text", {
    method: "POST",
    body: JSON.stringify({
      message,
      mode: "quick",
      transcript_window: transcript.slice(-10),
    }),
  });
}
export async function getLogs() {
  return jsonFetch<{ items: unknown[] }>("/logs");
}
