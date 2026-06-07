import type { GeminiFunctionCall } from "./types";

export function normalizeFunctionCall(
  rawCall: Record<string, unknown>,
): GeminiFunctionCall | null {
  const name = typeof rawCall.name === "string" ? rawCall.name : "";
  if (!name) return null;
  const rawArgs = rawCall.args ?? rawCall.arguments ?? {};
  return {
    id: typeof rawCall.id === "string" && rawCall.id ? rawCall.id : name,
    name,
    args:
      rawArgs && typeof rawArgs === "object"
        ? (rawArgs as Record<string, unknown>)
        : {},
  };
}

export function asResponseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  return { result: value };
}
