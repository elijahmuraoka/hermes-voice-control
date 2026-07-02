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
  const text = decodeServerMessageData(data);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decodeServerMessageData(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (isArrayBufferLike(data)) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  return null;
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Object.prototype.toString.call(value) === "[object ArrayBuffer]"
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
