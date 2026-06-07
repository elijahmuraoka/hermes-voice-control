import type { TranscriptEntry } from "./types";
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8765";
async function jsonFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  if (!res.ok)
    throw new Error((await res.text()).slice(0, 200) || `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
export async function login(pin: string) {
  return jsonFetch<{ ok: boolean; session_id: string; expires_at: string }>(
    "/auth/pin",
    { method: "POST", body: JSON.stringify({ pin }) },
  );
}
export async function getGeminiToken() {
  return jsonFetch<{ token: string; expires_at: string; mode: string }>(
    "/gemini/ephemeral-token",
    { method: "POST" },
  );
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
