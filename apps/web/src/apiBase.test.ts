import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeminiFunctionCall } from "./gemini-live/types";

type EnvValue = string | boolean | undefined;

async function loadClientModules(env: Record<string, EnvValue>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) {
    // Vitest supports boolean stubs for import.meta.env.DEV/PROD at runtime,
    // but its public type only accepts string env values.
    if (value !== undefined) vi.stubEnv(key, value as unknown as string);
  }
  const api = await import("./api");
  const defaults = await import("./gemini-live/defaults");
  const config = await import("./config");
  return { api, defaults, config };
}

function stubSuccessfulFetch() {
  const requests: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const requestUrl = String(url);
    requests.push(requestUrl);
    const body = requestUrl.includes("/auth/session")
      ? { authenticated: true }
      : requestUrl.includes("/auth/pin")
        ? { ok: true, expires_at: "2026-01-01T00:00:00Z" }
        : requestUrl.includes("/gemini/ephemeral-token")
          ? {
              token: "ephemeral-token",
              expires_at: "2026-01-01T00:00:00Z",
              mode: "real",
            }
          : requestUrl.includes("/chat/text")
            ? {
                status: "ok",
                result: { speakable: "hello", display: "hello" },
              }
            : { ok: true };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

async function callEveryBrowserApi(
  api: Awaited<ReturnType<typeof loadClientModules>>["api"],
  defaults: Awaited<ReturnType<typeof loadClientModules>>["defaults"],
) {
  const call: GeminiFunctionCall = {
    id: "call-1",
    name: "ask_agent",
    args: { message: "hello" },
  };
  await api.getSession();
  await api.login("private-pin");
  await api.sendText("hello", []);
  await api.getGeminiToken();
  await defaults.defaultTokenProvider();
  await defaults.defaultToolCaller(call, {
    signal: new AbortController().signal,
  });
  await defaults.defaultToolCanceler(["call-1"]);
}

describe("apiBase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("uses same-origin API paths in production by default", async () => {
    const { requests } = stubSuccessfulFetch();
    const { api, defaults, config } = await loadClientModules({
      DEV: false,
      PROD: true,
      VITE_API_BASE: "",
    });

    await callEveryBrowserApi(api, defaults);

    expect(config.apiBase).toBe("");
    expect(requests).toEqual([
      "/auth/session",
      "/auth/pin",
      "/chat/text",
      "/gemini/ephemeral-token",
      "/gemini/ephemeral-token",
      "/tools/call",
      "/tools/cancel",
    ]);
  });

  it("keeps localhost as the default backend for Vite dev", async () => {
    const { config } = await loadClientModules({
      DEV: true,
      PROD: false,
      VITE_API_BASE: "",
    });

    expect(config.apiBase).toBe("http://127.0.0.1:8765");
  });

  it("honors an explicit API base override", async () => {
    const { requests } = stubSuccessfulFetch();
    const { api, defaults, config } = await loadClientModules({
      DEV: false,
      PROD: true,
      VITE_API_BASE: "https://hvc.example.test/api",
    });

    await api.getSession();
    await defaults.defaultTokenProvider();

    expect(config.apiBase).toBe("https://hvc.example.test/api");
    expect(requests).toEqual([
      "https://hvc.example.test/api/auth/session",
      "https://hvc.example.test/api/gemini/ephemeral-token",
    ]);
  });
});
