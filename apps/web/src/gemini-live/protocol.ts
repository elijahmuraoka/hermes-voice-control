const LIVE_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export const SOCKET_OPEN = 1;

export function buildGeminiLiveUrl(token: string): string {
  return `${LIVE_ENDPOINT}?access_token=${encodeURIComponent(token)}`;
}

export function toGeminiModelResource(model: string): string {
  return model.startsWith('models/') ? model : `models/${model}`;
}

export function parseServerMessage(
  data: unknown,
): Record<string, unknown> | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
