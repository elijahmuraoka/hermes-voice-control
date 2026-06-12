import type {
  GeminiEphemeralToken,
  GeminiFunctionCall,
  GeminiToolCallContext,
  GeminiToolDeclaration,
} from "./types";
import { apiBase } from "../config";

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
  const res = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok)
    throw new Error(
      `${(await res.text()).slice(0, 200) || "Request failed"} (HTTP ${res.status})`,
    );
  return res.json() as Promise<T>;
}

export function defaultTools(): GeminiToolDeclaration[] {
  return [
    {
      functionDeclarations: [
        {
          name: "ask_agent",
          description: "Ask Bob for a speakable answer through the private Hermes bridge.",
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
