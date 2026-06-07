import type {
  GeminiEphemeralToken,
  GeminiFunctionCall,
  GeminiToolCallContext,
  GeminiToolDeclaration,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8765";

export async function defaultTokenProvider(): Promise<GeminiEphemeralToken> {
  return jsonFetch<GeminiEphemeralToken>("/gemini/ephemeral-token", {
    method: "POST",
  });
}

export async function defaultToolCaller(
  call: GeminiFunctionCall,
  context: GeminiToolCallContext,
): Promise<unknown> {
  return jsonFetch("/tools/call", {
    method: "POST",
    signal: context.signal,
    body: JSON.stringify({
      request_id: call.id,
      tool: call.name,
      arguments: call.args,
    }),
  });
}

export async function defaultToolCanceler(requestIds: string[]): Promise<unknown> {
  return jsonFetch("/tools/cancel", {
    method: "POST",
    body: JSON.stringify({ request_ids: requestIds }),
  });
}

async function jsonFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok)
    throw new Error((await res.text()).slice(0, 200) || `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function defaultTools(): GeminiToolDeclaration[] {
  return [
    {
      functionDeclarations: [
        {
          name: "ask_bob",
          description: "Ask the configured Hermes agent for a speakable answer.",
          parameters: {
            type: "OBJECT",
            properties: {
              message: { type: "STRING" },
              mode: { type: "STRING", enum: ["quick", "deep"] },
              transcript_window: { type: "ARRAY", items: { type: "OBJECT" } },
            },
            required: ["message"],
          },
        },
        {
          name: "propose_action",
          description: "Queue a risky action proposal for explicit approval.",
          parameters: {
            type: "OBJECT",
            properties: {
              summary: { type: "STRING" },
              payload: { type: "OBJECT" },
            },
            required: ["summary"],
          },
        },
      ],
    },
  ];
}
