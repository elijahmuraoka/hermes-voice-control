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
        : requestUrl.includes("/chat/jobs/job-1/cancel")
          ? { job_id: "job-1", state: "cancelled", cancelled: true }
          : requestUrl.includes("/chat/jobs/job-1")
            ? {
                job_id: "job-1",
                state: "complete",
                result: {
                  status: "completed",
                  result: { speakable: "hello", display: "hello" },
                },
              }
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
  await api.getTextJob("job-1");
  await api.cancelTextJob("job-1");
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
      "/chat/jobs/job-1",
      "/chat/jobs/job-1/cancel",
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

  it("requests background job mode for typed chat", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      calls.push({ url: requestUrl, init });
      if (requestUrl.includes("/chat/text")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ job_id: "job-mode", state: "thinking" }),
            {
              status: 202,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await loadClientModules({
      DEV: false,
      PROD: true,
      VITE_API_BASE: "",
    });

    await expect(api.sendText("slow", [])).resolves.toEqual({
      job_id: "job-mode",
      state: "thinking",
    });

    const chatCall = calls.find((call) => call.url === "/chat/text");
    expect(chatCall).toBeTruthy();
    const chatBody = JSON.parse(String(chatCall?.init?.body));
    expect(chatBody.request_id).toMatch(/^text-/);
    expect(chatBody).toEqual(
      expect.objectContaining({
        job: true,
        interactive_budget_ms: 750,
        message: "slow",
        mode: "quick",
      }),
    );
  });

  it("times out a blackholed typed chat job creation request", async () => {
    vi.useFakeTimers();
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      calls.push({ url: requestUrl, init });
      if (requestUrl.includes("/chat/text")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await loadClientModules({
      DEV: false,
      PROD: true,
      VITE_API_BASE: "",
    });

    const request = expect(api.sendText("slow", [], 25)).rejects.toThrow(
      api.ApiRequestTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(25);
    await request;

    expect(calls.map((call) => call.url)).toEqual(["/chat/text"]);
  });
});
