import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const realtimeMock = vi.hoisted(() => ({
  instances: [] as any[],
  connectError: null as Error | null,
  createError: null as Error | null,
  connectGate: null as { promise: Promise<void>; resolve: () => void } | null,
  emitInitialStatuses: true,
}));

let sessionAuthenticated = true;
let chatAuthExpired = false;
let chatPostMode: "fast" | "job" | "never" = "fast";
let chatPollAuthExpired = false;
let chatCancelAuthExpired = false;
let chatJobCounter = 0;
let chatJobIds: string[] = [];
let chatTextBodies: unknown[] = [];

interface MockSpeechUtterance {
  text: string;
  rate: number;
  pitch: number;
  volume: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

interface SpeechSynthesisTestMock {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  utterances: MockSpeechUtterance[];
  finish: (index?: number) => void;
  setPending: (pending: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
}

interface TestVoiceSession {
  callbacks: {
    onStatus?: (status: "agent-speaking" | "turn-complete") => void;
    onTranscript?: (event: {
      role: "user" | "agent";
      text: string;
      final: boolean;
    }) => void;
    onToolCall?: (call: {
      id: string;
      name: string;
      args: Record<string, unknown>;
    }) => void;
    onToolResponse?: (response: {
      id: string;
      name: string;
      response: Record<string, unknown>;
    }) => void;
  };
  setMicrophoneEnabled: ReturnType<typeof vi.fn>;
}

type MockChatJobState =
  | "queued"
  | "thinking"
  | "needs_permission"
  | "complete"
  | "cancelled"
  | "failed";

interface MockChatJobStatus {
  job_id: string;
  state: MockChatJobState;
  cancelled?: boolean;
  result?: {
    status?: string;
    request_id?: string;
    result?: { speakable?: string; display?: string; mode?: string };
  };
  error?: { code?: string | null; detail?: string; status_code?: number };
}

const chatJobStatuses = new Map<string, MockChatJobStatus[]>();
const chatCancelStatuses = new Map<string, MockChatJobStatus>();

function chatJobStatus(
  jobId: string,
  state: MockChatJobState,
  overrides: Partial<MockChatJobStatus> = {},
): MockChatJobStatus {
  return { job_id: jobId, state, ...overrides };
}

function completedChatJob(
  jobId: string,
  display: string,
  speakable = display,
): MockChatJobStatus {
  return chatJobStatus(jobId, "complete", {
    result: {
      status: "completed",
      request_id: jobId,
      result: { speakable, display },
    },
  });
}

function nextChatJobStatus(jobId: string): MockChatJobStatus | null {
  const statuses = chatJobStatuses.get(jobId);
  if (!statuses || statuses.length === 0) return null;
  if (statuses.length === 1) return statuses[0];
  const next = statuses.shift();
  return next ?? null;
}

function jobPollCallCount(jobId: string): number {
  return (
    fetch as unknown as { mock: { calls: Array<[unknown, RequestInit?]> } }
  ).mock.calls.filter(([url]) => {
    const requestUrl = String(url);
    return (
      requestUrl.includes(`/chat/jobs/${jobId}`) &&
      !requestUrl.endsWith("/cancel")
    );
  }).length;
}

function installSpeechSynthesisMock({
  speaking = false,
  pending = false,
}: { speaking?: boolean; pending?: boolean } = {}): SpeechSynthesisTestMock {
  const utterances: MockSpeechUtterance[] = [];
  const state = { speaking, pending };
  const speak = vi.fn((utterance: MockSpeechUtterance) => {
    utterances.push(utterance);
    state.speaking = true;
  });
  const cancel = vi.fn();
  const speechSynthesis = {
    speak,
    cancel,
    get speaking() {
      return state.speaking;
    },
    get pending() {
      return state.pending;
    },
  };
  class MockSpeechSynthesisUtterance implements MockSpeechUtterance {
    text: string;
    rate = 1;
    pitch = 1;
    volume = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(text: string) {
      this.text = text;
    }
  }

  vi.stubGlobal("speechSynthesis", speechSynthesis);
  vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance);

  return {
    speak,
    cancel,
    utterances,
    finish(index = 0) {
      state.speaking = false;
      utterances[index]?.onend?.();
    },
    setPending(pending: boolean) {
      state.pending = pending;
    },
    setSpeaking(speaking: boolean) {
      state.speaking = speaking;
    },
  };
}

function createStorageMock(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear() {
      items.clear();
    },
    getItem(key: string) {
      return items.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(items.keys())[index] ?? null;
    },
    removeItem(key: string) {
      items.delete(key);
    },
    setItem(key: string, value: string) {
      items.set(key, value);
    },
  };
}

function createConnectGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

vi.mock("./realtime", () => {
  class MockRealtimeVoiceSession {
    callbacks: any;
    connect = vi.fn(async () => {
      if (realtimeMock.connectError) throw realtimeMock.connectError;
      if (realtimeMock.connectGate) await realtimeMock.connectGate.promise;
      this.callbacks.onToken?.({
        expires_at: "2026-01-01T00:00:00Z",
        mode: "test",
        provider: "gemini",
      });
      if (realtimeMock.emitInitialStatuses) {
        this.callbacks.onStatus?.("setup-complete");
        this.callbacks.onStatus?.("listening");
      }
    });
    disconnect = vi.fn();
    resume = vi.fn();
    setMicrophoneEnabled = vi.fn();
    setHoldToTalk = vi.fn();
    abandonPendingResponse = vi.fn();
    finalizeInputTurn = vi.fn(() => true);
    interrupt = vi.fn(() => this.callbacks.onStatus?.("interrupted"));

    constructor(options: any) {
      this.callbacks = options.callbacks;
      realtimeMock.instances.push(this);
    }
  }

  return {
    createDefaultRealtimeVoiceSession: (options: any) => {
      if (realtimeMock.createError) throw realtimeMock.createError;
      return new MockRealtimeVoiceSession(options);
    },
  };
});

describe("App", () => {
  beforeEach(() => {
    realtimeMock.instances.length = 0;
    realtimeMock.connectError = null;
    realtimeMock.createError = null;
    realtimeMock.connectGate = null;
    realtimeMock.emitInitialStatuses = true;
    sessionAuthenticated = true;
    chatAuthExpired = false;
    chatPostMode = "fast";
    chatPollAuthExpired = false;
    chatCancelAuthExpired = false;
    chatJobCounter = 0;
    chatJobIds = [];
    chatTextBodies = [];
    chatJobStatuses.clear();
    chatCancelStatuses.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const requestUrl = String(url);
        if (requestUrl.includes("/auth/session")) {
          return new Response(
            JSON.stringify({ authenticated: sessionAuthenticated }),
            {
              status: sessionAuthenticated ? 200 : 401,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        if (requestUrl.includes("/auth/pin")) {
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          if (body.pin === "wrong") {
            return new Response(JSON.stringify({ detail: "Invalid PIN" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
          sessionAuthenticated = true;
          return new Response(
            JSON.stringify({
              ok: true,
              expires_at: "2026-01-01T00:00:00Z",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        if (requestUrl.includes("/tools/cancel")) {
          return new Response(JSON.stringify({ status: "cancelled" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (requestUrl.includes("/chat/jobs/")) {
          const parsedUrl = new URL(requestUrl, "http://hvc.test");
          const parts = parsedUrl.pathname.split("/");
          const jobId = decodeURIComponent(parts[3] ?? "");
          if (parsedUrl.pathname.endsWith("/cancel")) {
            if (chatCancelAuthExpired) {
              return new Response(JSON.stringify({ detail: "Session expired" }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
              });
            }
            const status =
              chatCancelStatuses.get(jobId) ??
              chatJobStatus(jobId, "cancelled", { cancelled: true });
            return new Response(JSON.stringify(status), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (chatPollAuthExpired) {
            return new Response(JSON.stringify({ detail: "Session expired" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
          const status = nextChatJobStatus(jobId);
          if (!status) {
            return new Response(JSON.stringify({ detail: "Chat job not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify(status), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (requestUrl.includes("/chat/text")) {
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          chatTextBodies.push(body);
          if (chatAuthExpired) {
            return new Response(JSON.stringify({ detail: "Session expired" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (chatPostMode === "never") {
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")),
              );
            });
          }
          if (chatPostMode === "job") {
            const jobId = chatJobIds.shift() ?? `job-${++chatJobCounter}`;
            const status =
              nextChatJobStatus(jobId) ?? chatJobStatus(jobId, "queued");
            return new Response(JSON.stringify(status), {
              status: 202,
              headers: {
                "Content-Type": "application/json",
                Location: `/chat/jobs/${jobId}`,
                "X-HVC-Chat-Job-Id": jobId,
              },
            });
          }
          return new Response(
            JSON.stringify({
              status: "completed",
              result: { speakable: "hello", display: "hello" },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function renderUnlockedApp() {
    render(<App />);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  }

  async function startListeningVoice(): Promise<TestVoiceSession> {
    const orb = screen.getByLabelText(/Voice orb/);
    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    return realtimeMock.instances[0] as TestVoiceSession;
  }

  async function startBackgroundTextJob(
    jobId: string,
    answer = "background answer",
    speakable = answer,
  ) {
    chatPostMode = "job";
    chatJobIds = [jobId];
    chatJobStatuses.set(jobId, [
      chatJobStatus(jobId, "thinking"),
      completedChatJob(jobId, answer, speakable),
    ]);
    fireEvent.change(screen.getByLabelText("Type a message to your Hermes agent"), {
      target: { value: `request ${jobId}` },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByText(/working on that in the background/i),
    ).toBeInTheDocument();
  }

  async function completeBackgroundTextJobPoll() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
      await Promise.resolve();
    });
  }

  it("renders premium voice surface and transcript toggle", async () => {
    await renderUnlockedApp();
    expect(screen.getByText("Hermes Agent")).toBeInTheDocument();
    expect(screen.getByLabelText(/Voice orb/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Toggle transcript/ }),
    ).toBeInTheDocument();
  });

  it("keeps primary voice controls first in keyboard order", async () => {
    const user = userEvent.setup();
    await renderUnlockedApp();

    await user.tab();
    expect(screen.getByLabelText(/Voice orb/)).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: /^Mute$/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: /^End$/ })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", {
        name: /Turn off spoken completion notices/i,
      }),
    ).toHaveFocus();
  });

  it("does not show default PIN or interrupt controls", async () => {
    await renderUnlockedApp();
    expect(screen.queryByLabelText(/Private PIN/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Interrupt/i }),
    ).not.toBeInTheDocument();
  });

  it("unlocks protected private sessions with a PIN", async () => {
    sessionAuthenticated = false;
    const user = userEvent.setup();
    render(<App />);

    const pinInput = await screen.findByLabelText("Private PIN");
    const orb = screen.getByLabelText(/Voice orb/);
    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    expect(realtimeMock.instances).toHaveLength(0);

    await user.type(pinInput, "abcdefgh");
    await user.click(screen.getByRole("button", { name: /^Unlock$/ }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 2 });

    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    expect(realtimeMock.instances).toHaveLength(1);
  });

  it("keeps typed chat available through the backend", async () => {
    const user = userEvent.setup();
    await renderUnlockedApp();
    const input = screen.getByLabelText("Type a message to your Hermes agent");

    await user.type(input, "hello");
    await user.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );

    await waitFor(() => expect(screen.getAllByText("hello")).toHaveLength(2));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/chat/text"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(chatTextBodies[0]).toEqual(
      expect.objectContaining({
        job: true,
        interactive_budget_ms: 0,
        message: "hello",
      }),
    );
  });

  it("recovers when the initial typed chat job creation request never returns", async () => {
    chatPostMode = "never";
    await renderUnlockedApp();
    vi.useFakeTimers();
    const input = screen.getByLabelText("Type a message to your Hermes agent");

    fireEvent.change(input, { target: { value: "blackholed request" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );

    expect(input).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
      await Promise.resolve();
    });

    expect(
      screen.getByText(/could not start that background reply/i),
    ).toBeInTheDocument();
    expect(input).not.toBeDisabled();
    expect(screen.queryByText(/shorter message/i)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/tools/cancel"),
      expect.anything(),
    );
  });

  it("shows slow typed chat as cancellable background work while voice stays usable", async () => {
    chatPostMode = "job";
    chatJobIds = ["job-slow"];
    chatJobStatuses.set("job-slow", [
      chatJobStatus("job-slow", "queued"),
      completedChatJob("job-slow", "slow answer"),
    ]);
    await renderUnlockedApp();
    vi.useFakeTimers();
    const input = screen.getByLabelText("Type a message to your Hermes agent");

    fireEvent.change(input, { target: { value: "slow request" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByText(/working on that in the background/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Cancel background reply/i }),
    ).toBeInTheDocument();
    expect(input).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Mute$/ }));
    expect(screen.getByText("Mic paused")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
      await Promise.resolve();
    });

    expect(screen.getByText("slow answer")).toBeInTheDocument();
    expect(screen.queryByText(/shorter message/i)).not.toBeInTheDocument();
  });

  it("cancels a running background typed chat from the transcript", async () => {
    chatPostMode = "job";
    chatJobIds = ["job-cancel"];
    chatJobStatuses.set("job-cancel", [chatJobStatus("job-cancel", "thinking")]);
    chatCancelStatuses.set(
      "job-cancel",
      chatJobStatus("job-cancel", "cancelled", { cancelled: true }),
    );
    await renderUnlockedApp();
    const input = screen.getByLabelText("Type a message to your Hermes agent");

    fireEvent.change(input, { target: { value: "cancel this" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );
    await waitFor(() =>
      expect(screen.getByText(/working on that in the background/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Cancel background reply/i }));

    await waitFor(() => expect(screen.getByText("Cancelled.")).toBeInTheDocument());
    expect(screen.getByText("cancelled")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/chat/jobs/job-cancel/cancel"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(window.sessionStorage.getItem("hvc.pendingTextJobs.v1")).toBe("[]");
  });

  it("recovers pending background typed chat after refresh without storing prompt text", async () => {
    chatPostMode = "job";
    chatJobIds = ["job-refresh"];
    chatJobStatuses.set("job-refresh", [
      chatJobStatus("job-refresh", "thinking"),
      completedChatJob("job-refresh", "restored answer"),
    ]);
    const { unmount } = render(<App />);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const input = screen.getByLabelText("Type a message to your Hermes agent");

    fireEvent.change(input, { target: { value: "private prompt text" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );
    await waitFor(() =>
      expect(screen.getByText(/working on that in the background/i)).toBeInTheDocument(),
    );
    const storedBeforeRefresh = window.sessionStorage.getItem(
      "hvc.pendingTextJobs.v1",
    );
    expect(storedBeforeRefresh).toContain("job-refresh");
    expect(storedBeforeRefresh).not.toContain("private prompt text");

    unmount();
    render(<App />);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/background reply from before the refresh/i),
      ).toBeInTheDocument(),
    );

    await waitFor(() =>
      expect(screen.getByText("restored answer")).toBeInTheDocument(),
    );
    expect(window.sessionStorage.getItem("hvc.pendingTextJobs.v1")).toContain(
      "job-refresh",
    );
  });

  it("restores a completed background typed chat after refresh before TTL cleanup", async () => {
    chatPostMode = "job";
    chatJobIds = ["job-complete-refresh"];
    chatJobStatuses.set("job-complete-refresh", [
      chatJobStatus("job-complete-refresh", "thinking"),
      completedChatJob("job-complete-refresh", "completed before refresh"),
    ]);
    const { unmount } = render(<App />);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    vi.useFakeTimers();
    const input = screen.getByLabelText("Type a message to your Hermes agent");

    fireEvent.change(input, { target: { value: "private prompt before refresh" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1400);
      await Promise.resolve();
    });

    expect(screen.getByText("completed before refresh")).toBeInTheDocument();
    const storedAfterCompletion = window.sessionStorage.getItem(
      "hvc.pendingTextJobs.v1",
    );
    expect(storedAfterCompletion).toContain("job-complete-refresh");
    expect(storedAfterCompletion).not.toContain("private prompt before refresh");
    expect(storedAfterCompletion).not.toContain("completed before refresh");

    const pollsBeforeRefresh = jobPollCallCount("job-complete-refresh");
    vi.useRealTimers();
    unmount();
    render(<App />);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await waitFor(() =>
      expect(screen.getByText("completed before refresh")).toBeInTheDocument(),
    );
    expect(jobPollCallCount("job-complete-refresh")).toBeGreaterThan(
      pollsBeforeRefresh,
    );
    expect(window.sessionStorage.getItem("hvc.pendingTextJobs.v1")).toContain(
      "job-complete-refresh",
    );
  });

  it("keeps chat rendering when sessionStorage property access is blocked", async () => {
    const originalSessionStorage = Object.getOwnPropertyDescriptor(
      window,
      "sessionStorage",
    );
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
    try {
      chatPostMode = "job";
      chatJobIds = ["job-storage-blocked"];
      chatJobStatuses.set("job-storage-blocked", [
        chatJobStatus("job-storage-blocked", "thinking"),
        completedChatJob("job-storage-blocked", "storage-safe answer"),
      ]);
      await renderUnlockedApp();
      vi.useFakeTimers();

      fireEvent.change(
        screen.getByLabelText("Type a message to your Hermes agent"),
        { target: { value: "storage is blocked" } },
      );
      fireEvent.click(
        screen.getByRole("button", { name: /Send typed message/ }),
      );
      await act(async () => {
        await Promise.resolve();
      });

      expect(
        screen.getByText(/working on that in the background/i),
      ).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1400);
        await Promise.resolve();
      });

      expect(screen.getByText("storage-safe answer")).toBeInTheDocument();
      expect(screen.queryByText(/Text chat could not reach/i)).not.toBeInTheDocument();
    } finally {
      if (originalSessionStorage) {
        Object.defineProperty(window, "sessionStorage", originalSessionStorage);
      }
    }
  });

  it("shows a natural permission-needed state without raw tool details", async () => {
    chatPostMode = "job";
    chatJobIds = ["job-permission"];
    chatJobStatuses.set("job-permission", [
      chatJobStatus("job-permission", "thinking"),
      chatJobStatus("job-permission", "needs_permission", {
        result: {
          status: "pending_confirmation",
          result: {
            display: "raw ask_agent tool payload should stay hidden",
            speakable: "raw ask_agent tool payload should stay hidden",
          },
        },
      }),
    ]);
    await renderUnlockedApp();
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Type a message to your Hermes agent"), {
      target: { value: "needs approval" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1400);
    });

    expect(screen.getByText(/needs permission before it can continue/i)).toBeInTheDocument();
    expect(screen.getByText("approval needed")).toBeInTheDocument();
    expect(screen.queryByText(/ask_agent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw.*payload/i)).not.toBeInTheDocument();
  });

  it("shows failed background typed chat with recovery copy", async () => {
    chatPostMode = "job";
    chatJobIds = ["job-failed"];
    chatJobStatuses.set("job-failed", [
      chatJobStatus("job-failed", "thinking"),
      chatJobStatus("job-failed", "failed", {
        error: {
          code: null,
          detail: "The Hermes agent could not answer right now.",
          status_code: 502,
        },
      }),
    ]);
    await renderUnlockedApp();
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Type a message to your Hermes agent"), {
      target: { value: "please fail" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1400);
    });

    expect(
      screen.getByText(/could not answer right now.*try again or keep using voice/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/shorter message/i)).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("hvc.pendingTextJobs.v1")).toBe("[]");
  });

  it("keeps multiple background typed chat jobs from overwriting each other", async () => {
    chatPostMode = "job";
    chatJobIds = ["job-one", "job-two"];
    chatJobStatuses.set("job-one", [
      chatJobStatus("job-one", "thinking"),
      completedChatJob("job-one", "first answer"),
    ]);
    chatJobStatuses.set("job-two", [
      chatJobStatus("job-two", "thinking"),
      completedChatJob("job-two", "second answer"),
    ]);
    await renderUnlockedApp();
    vi.useFakeTimers();
    const input = screen.getByLabelText("Type a message to your Hermes agent");
    const send = screen.getByRole("button", { name: /Send typed message/ });

    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(send);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.click(send);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getAllByText(/working on that in the background/i)).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
      await Promise.resolve();
    });

    expect(screen.getByText("first answer")).toBeInTheDocument();
    expect(screen.getByText("second answer")).toBeInTheDocument();
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("speaks a fresh background completion once when voice is safely listening", async () => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    const session = await startListeningVoice();
    vi.useFakeTimers();
    const privateSpeakable = "The porch lights are on, and this stays in text.";

    await startBackgroundTextJob(
      "job-spoken",
      "transcript stays complete",
      privateSpeakable,
    );
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("transcript stays complete")).toBeInTheDocument();
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.utterances[0].text).toBe("Done. Background reply is ready.");
    expect(speech.utterances[0].text).not.toContain("porch lights");
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    speech.finish();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
      await Promise.resolve();
    });
    expect(speech.speak).toHaveBeenCalledTimes(1);
  });

  it("does not restore the microphone while spoken completion audio is still active", async () => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    const session = await startListeningVoice();
    vi.useFakeTimers();

    await startBackgroundTextJob(
      "job-spoken-long",
      "long spoken transcript complete",
      "Long spoken completion summary.",
    );
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("long spoken transcript complete")).toBeInTheDocument();
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
      await Promise.resolve();
    });
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    speech.setSpeaking(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
  });

  it("cancels a stalled spoken completion notice and recovers capture controls", async () => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    const session = await startListeningVoice();
    vi.useFakeTimers();

    await startBackgroundTextJob(
      "job-spoken-stalled",
      "stalled speech transcript complete",
      "Stalled speech summary.",
    );
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("stalled speech transcript complete")).toBeInTheDocument();
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    speech.setPending(true);
    speech.setSpeaking(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10050);
      await Promise.resolve();
    });

    expect(speech.cancel).toHaveBeenCalledTimes(1);
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Mute$/ }));
    expect(screen.getByText("Mic paused")).toBeInTheDocument();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: /^Unmute$/ }));
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
  });

  it("keeps retrying mic restore after hard-stop until a pointer blocker clears", async () => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    const session = await startListeningVoice();
    vi.useFakeTimers();

    await startBackgroundTextJob(
      "job-spoken-stalled-pointer",
      "stalled pointer transcript complete",
      "Stalled pointer summary.",
    );
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("stalled pointer transcript complete")).toBeInTheDocument();
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    speech.setPending(true);
    speech.setSpeaking(true);
    const orb = screen.getByLabelText(/Voice orb/);
    fireEvent.pointerDown(orb, { pointerId: 6, button: 0 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(230);
    });
    expect(screen.queryByText("Holding to talk")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10050);
      await Promise.resolve();
    });

    expect(speech.cancel).toHaveBeenCalledTimes(1);
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    fireEvent.pointerUp(orb, { pointerId: 6 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });

    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
  });

  it("retries spoken completion mic restore after a transient pointer blocker clears", async () => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    const session = await startListeningVoice();
    vi.useFakeTimers();

    await startBackgroundTextJob(
      "job-spoken-pointer-blocked",
      "pointer blocked transcript answer",
      "Pointer blocked summary.",
    );
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("pointer blocked transcript answer")).toBeInTheDocument();
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    const orb = screen.getByLabelText(/Voice orb/);
    fireEvent.pointerDown(orb, { pointerId: 4, button: 0 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(230);
    });
    expect(screen.queryByText("Holding to talk")).not.toBeInTheDocument();

    speech.finish();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await Promise.resolve();
    });
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    fireEvent.pointerUp(orb, { pointerId: 4 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
  });

  it("does not let provider turn-complete restore capture during spoken completion audio", async () => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    const session = await startListeningVoice();
    vi.useFakeTimers();

    await startBackgroundTextJob(
      "job-spoken-turn-complete",
      "turn complete transcript answer",
      "Turn complete summary.",
    );
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("turn complete transcript answer")).toBeInTheDocument();
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    act(() => {
      session.callbacks.onStatus?.("turn-complete");
    });
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    speech.finish();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
  });

  it("does not start a fresh voice session while spoken completion audio is active", async () => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    await startListeningVoice();
    vi.useFakeTimers();

    await startBackgroundTextJob(
      "job-spoken-fresh-start",
      "fresh start transcript answer",
      "Fresh start summary.",
    );
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("fresh start transcript answer")).toBeInTheDocument();
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(realtimeMock.instances).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /^End$/ }));
    expect(screen.getByText("Tap to talk to Hermes Agent")).toBeInTheDocument();

    const orb = screen.getByLabelText(/Voice orb/);
    fireEvent.pointerDown(orb, { pointerId: 5, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 5 });
    await act(async () => {
      await Promise.resolve();
    });

    expect(realtimeMock.instances).toHaveLength(1);
    expect(screen.getByText("Tap to talk to Hermes Agent")).toBeInTheDocument();
  });

  it("does not let unmute or hold-to-talk enable capture during spoken completion audio", async () => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    const session = await startListeningVoice();
    vi.useFakeTimers();

    await startBackgroundTextJob(
      "job-spoken-direct-controls",
      "direct controls transcript answer",
      "Direct controls summary.",
    );
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("direct controls transcript answer")).toBeInTheDocument();
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: /^Mute$/ }));
    expect(screen.getByText("Mic paused")).toBeInTheDocument();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: /^Unmute$/ }));
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    const orb = screen.getByLabelText(/Voice orb/);
    fireEvent.pointerDown(orb, { pointerId: 3, button: 0 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(230);
    });
    expect(screen.queryByText("Holding to talk")).not.toBeInTheDocument();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    fireEvent.pointerUp(orb, { pointerId: 3 });

    speech.finish();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
  });

  it("does not speak when a background completion arrives while the composer remains focused after Enter submit", async () => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    const session = await startListeningVoice();
    const user = userEvent.setup();
    chatPostMode = "job";
    chatJobIds = ["job-focused-enter"];
    chatJobStatuses.set("job-focused-enter", [
      chatJobStatus("job-focused-enter", "thinking"),
      completedChatJob(
        "job-focused-enter",
        "focused composer transcript complete",
        "Focused composer summary.",
      ),
    ]);

    const input = screen.getByLabelText("Type a message to your Hermes agent");
    await user.type(input, "keep typing here{enter}");
    await act(async () => {
      await Promise.resolve();
    });

    expect(input).toHaveFocus();
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);

    await waitFor(
      () =>
        expect(
          screen.getByText("focused composer transcript complete"),
        ).toBeInTheDocument(),
      { timeout: 2200 },
    );
    expect(input).toHaveFocus();
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it("does not speak while a hands-free user turn is awaiting provider completion", async () => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    const session = await startListeningVoice();
    vi.useFakeTimers();

    await startBackgroundTextJob(
      "job-hands-free-pending",
      "hands-free-safe answer",
      "Hands-free safe summary.",
    );
    act(() => {
      session.callbacks.onTranscript?.({
        role: "user",
        text: "finish the kitchen lights",
        final: true,
      });
    });
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("hands-free-safe answer")).toBeInTheDocument();
    expect(speech.speak).not.toHaveBeenCalled();
    expect(session.setMicrophoneEnabled).not.toHaveBeenLastCalledWith(false);
  });

  it("does not speak while a tool-backed hands-free voice request remains pending", async () => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    const session = await startListeningVoice();
    vi.useFakeTimers();

    act(() => {
      session.callbacks.onTranscript?.({
        role: "user",
        text: "check the house",
        final: true,
      });
      session.callbacks.onToolCall?.({
        id: "tool-hands-free",
        name: "ask_agent",
        args: { message: "check the house" },
      });
      session.callbacks.onStatus?.("turn-complete");
      session.callbacks.onToolResponse?.({
        id: "tool-hands-free",
        name: "ask_agent",
        response: { status: "completed" },
      });
    });

    await startBackgroundTextJob(
      "job-hands-free-tool-pending",
      "tool-backed transcript answer",
      "Tool-backed summary.",
    );
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("tool-backed transcript answer")).toBeInTheDocument();
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it("uses transcript only when no voice session is connected", async () => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    vi.useFakeTimers();

    await startBackgroundTextJob("job-idle", "idle transcript answer");
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("idle transcript answer")).toBeInTheDocument();
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it.each([
    [
      "voice is muted",
      async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Mute$/ }));
        expect(screen.getByText("Mic paused")).toBeInTheDocument();
      },
    ],
    [
      "voice is paused",
      async () => {
        const orb = screen.getByLabelText(/Voice orb/);
        fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
        fireEvent.pointerUp(orb, { pointerId: 2 });
        expect(screen.getByText("Paused")).toBeInTheDocument();
      },
    ],
    [
      "the user is holding to talk",
      async () => {
        const orb = screen.getByLabelText(/Voice orb/);
        fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(230);
        });
        expect(screen.getByText("Holding to talk")).toBeInTheDocument();
      },
    ],
    [
      "the voice turn is waiting on the agent",
      async () => {
        const orb = screen.getByLabelText(/Voice orb/);
        fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(230);
        });
        fireEvent.pointerUp(orb, { pointerId: 2 });
        expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();
      },
    ],
    [
      "user speech is streaming",
      async () => {
        act(() => {
          realtimeMock.instances[0].callbacks.onTranscript({
            role: "user",
            text: "still talking",
            final: false,
          });
        });
        expect(screen.getByLabelText("Live transcript")).toHaveTextContent(
          "still talking",
        );
      },
    ],
    [
      "the agent is already speaking",
      async () => {
        act(() => {
          realtimeMock.instances[0].callbacks.onStatus("agent-speaking");
        });
        expect(screen.getByText("Hermes Agent is speaking")).toBeInTheDocument();
      },
    ],
    [
      "text input is active",
      async () => {
        fireEvent.focus(
          screen.getByLabelText("Type a message to your Hermes agent"),
        );
        expect(screen.getByText("Tap to talk to Hermes Agent")).toBeInTheDocument();
      },
    ],
  ])("uses transcript only when %s", async (_name, makeUnsafe) => {
    const speech = installSpeechSynthesisMock();
    await renderUnlockedApp();
    await startListeningVoice();
    vi.useFakeTimers();

    await startBackgroundTextJob(`job-unsafe-${String(_name).replaceAll(" ", "-")}`);
    await makeUnsafe();
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("background answer")).toBeInTheDocument();
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it("persists the spoken completion toggle and leaves transcript completion intact", async () => {
    const speech = installSpeechSynthesisMock();
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", {
        name: /Turn off spoken completion notices/i,
      }),
    );
    expect(
      window.localStorage.getItem("hvc.spokenCompletionNotifications.v1"),
    ).toBe("disabled");
    expect(
      screen.getByRole("button", {
        name: /Turn on spoken completion notices/i,
      }),
    ).toBeInTheDocument();

    unmount();
    render(<App />);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", {
        name: /Turn on spoken completion notices/i,
      }),
    ).toBeInTheDocument();

    await startListeningVoice();
    vi.useFakeTimers();
    await startBackgroundTextJob("job-toggle-off", "toggle transcript answer");
    await completeBackgroundTextJobPoll();

    expect(screen.getByText("toggle transcript answer")).toBeInTheDocument();
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it("keeps chat working when localStorage access is blocked", async () => {
    const originalLocalStorage = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
    try {
      await renderUnlockedApp();
      fireEvent.click(
        screen.getByRole("button", {
          name: /Turn off spoken completion notices/i,
        }),
      );
      vi.useFakeTimers();

      await startBackgroundTextJob("job-localstorage-blocked", "storage answer");
      await completeBackgroundTextJobPoll();

      expect(screen.getByText("storage answer")).toBeInTheDocument();
    } finally {
      if (originalLocalStorage) {
        Object.defineProperty(window, "localStorage", originalLocalStorage);
      }
    }
  });

  it("does not speak restored background completions after refresh", async () => {
    const speech = installSpeechSynthesisMock();
    window.sessionStorage.setItem(
      "hvc.pendingTextJobs.v1",
      JSON.stringify([{ jobId: "job-restored-spoken", savedAt: Date.now() }]),
    );
    chatJobStatuses.set("job-restored-spoken", [
      chatJobStatus("job-restored-spoken", "thinking"),
      completedChatJob("job-restored-spoken", "restored spoken answer"),
    ]);
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByText(/background reply from before the refresh/i),
      ).toBeInTheDocument(),
    );
    await startListeningVoice();

    await waitFor(
      () =>
        expect(screen.getByText("restored spoken answer")).toBeInTheDocument(),
      { timeout: 2200 },
    );
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it("reopens unlock when background job polling loses auth", async () => {
    chatPostMode = "job";
    chatJobIds = ["job-auth"];
    chatJobStatuses.set("job-auth", [chatJobStatus("job-auth", "thinking")]);
    await renderUnlockedApp();
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Type a message to your Hermes agent"), {
      target: { value: "auth expires later" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    chatPollAuthExpired = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
      await Promise.resolve();
    });

    expect(screen.getByLabelText("Private PIN")).toBeInTheDocument();
    expect(
      screen.getByText("Session expired. Enter your private PIN again."),
    ).toBeInTheDocument();
  });

  it("does not resume hands-free capture just because the text composer blurs", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    const session = realtimeMock.instances[0];
    const input = screen.getByLabelText("Type a message to your Hermes agent");
    fireEvent.focus(input);
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(screen.getByText("Tap to talk to Hermes Agent")).toBeInTheDocument();

    fireEvent.blur(input);

    expect(session.resume).not.toHaveBeenCalled();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(screen.getByText("Tap to talk to Hermes Agent")).toBeInTheDocument();
  });

  it("restores hands-free capture after a successful typed send from a live session", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    const session = realtimeMock.instances[0];
    const input = screen.getByLabelText("Type a message to your Hermes agent");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "hello" } });
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    fireEvent.blur(input);
    fireEvent.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );

    await waitFor(() => expect(screen.getAllByText("hello")).toHaveLength(2));
    await waitFor(
      () => {
        expect(session.resume).toHaveBeenCalled();
        expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
      },
      { timeout: 1500 },
    );
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
  });

  it("preserves capture restore when text composer is blurred and refocused", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    const session = realtimeMock.instances[0];
    const input = screen.getByLabelText("Type a message to your Hermes agent");
    fireEvent.focus(input);
    fireEvent.blur(input);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );

    await waitFor(() => expect(screen.getAllByText("hello")).toHaveLength(2));
    await waitFor(
      () => {
        expect(session.resume).toHaveBeenCalled();
        expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
      },
      { timeout: 1500 },
    );
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
  });

  it("does not reopen the mic when the composer is refocused before typed response completion", async () => {
    const user = userEvent.setup();
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    const session = realtimeMock.instances[0];
    const input = screen.getByLabelText("Type a message to your Hermes agent");
    await user.type(input, "hello{enter}");

    await waitFor(() => expect(screen.getAllByText("hello")).toHaveLength(2));
    fireEvent.blur(input);
    fireEvent.focus(input);

    await waitFor(
      () => expect(screen.getByText("Tap to talk to Hermes Agent")).toBeInTheDocument(),
      { timeout: 1500 },
    );
    expect(session.resume).not.toHaveBeenCalled();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    await user.type(input, "again{enter}");
    await waitFor(() => expect(screen.getAllByText("again")).toHaveLength(1));
    await waitFor(
      () => {
        expect(session.resume).toHaveBeenCalled();
        expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
      },
      { timeout: 1500 },
    );
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
  });

  it("restores hands-free capture after submitting typed text with Enter", async () => {
    const user = userEvent.setup();
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    const session = realtimeMock.instances[0];
    const input = screen.getByLabelText("Type a message to your Hermes agent");
    await user.type(input, "hello{enter}");

    await waitFor(() => expect(screen.getAllByText("hello")).toHaveLength(2));
    await waitFor(
      () => {
        expect(session.resume).toHaveBeenCalled();
        expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
      },
      { timeout: 1500 },
    );
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
  });

  it("keeps an intentionally paused session paused after typed text send", async () => {
    const user = userEvent.setup();
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 2 });
    expect(screen.getByText("Paused")).toBeInTheDocument();

    const session = realtimeMock.instances[0];
    const input = screen.getByLabelText("Type a message to your Hermes agent");
    await user.type(input, "hello{enter}");

    await waitFor(() => expect(screen.getAllByText("hello")).toHaveLength(2));
    await waitFor(
      () => expect(screen.getByText("Paused")).toBeInTheDocument(),
      { timeout: 1500 },
    );
    expect(session.resume).not.toHaveBeenCalled();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
  });

  it("keeps a muted session muted after typed text send", async () => {
    const user = userEvent.setup();
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /^Mute$/ }));
    expect(screen.getByText("Mic paused")).toBeInTheDocument();

    const session = realtimeMock.instances[0];
    const input = screen.getByLabelText("Type a message to your Hermes agent");
    await user.type(input, "hello{enter}");

    await waitFor(() => expect(screen.getAllByText("hello")).toHaveLength(2));
    await waitFor(
      () => expect(screen.getByText("Mic paused")).toBeInTheDocument(),
      { timeout: 1500 },
    );
    expect(session.resume).not.toHaveBeenCalled();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
  });

  it("uses the first orb tap after text focus to resume capture", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    const session = realtimeMock.instances[0];
    const input = screen.getByLabelText("Type a message to your Hermes agent");
    fireEvent.focus(input);
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(screen.getByText("Tap to talk to Hermes Agent")).toBeInTheDocument();

    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 2 });

    expect(session.resume).toHaveBeenCalled();
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
  });

  it("activates hold-to-talk after returning from text mode with an existing session", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    const input = screen.getByLabelText("Type a message to your Hermes agent");
    fireEvent.focus(input);
    expect(screen.getByText("Tap to talk to Hermes Agent")).toBeInTheDocument();
    fireEvent.blur(input);

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));

    expect(screen.getByText("Holding to talk")).toBeInTheDocument();
    expect(realtimeMock.instances[0].setHoldToTalk).toHaveBeenLastCalledWith(
      true,
    );
  });

  it("first orb tap constructs and connects one realtime session, then shows listening status", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });

    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    expect(screen.queryByText("test voice")).not.toBeInTheDocument();
    expect(realtimeMock.instances).toHaveLength(1);
    expect(realtimeMock.instances[0].connect).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/gemini/ephemeral-token"),
      expect.anything(),
    );
  });

  it("records redacted diagnostics when initial voice connection fails", async () => {
    realtimeMock.connectError = new Error("token=secret session_id=sess_123456");
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });

    await waitFor(() =>
      expect(screen.getByText(/Could not prepare/)).toBeInTheDocument(),
    );
    const snapshot = (window as any).__HVC_DIAGNOSTICS__.snapshot();

    expect(snapshot.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "session_start" }),
        expect.objectContaining({
          name: "session_error",
          detail: { message: "token=[redacted] session_id=[redacted]" },
        }),
      ]),
    );
    expect(JSON.stringify(snapshot)).not.toContain("token=secret");
    expect(JSON.stringify(snapshot)).not.toContain("sess_123456");
  });

  it("reopens the PIN gate when realtime auth expires", async () => {
    realtimeMock.connectError = new Error('{"detail":"Session expired"}');
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });

    await waitFor(() =>
      expect(screen.getByLabelText("Private PIN")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Session expired. Enter your private PIN again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Could not prepare/)).not.toBeInTheDocument();
  });

  it("clears an active realtime session when text auth expires", async () => {
    const user = userEvent.setup();
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    const first = realtimeMock.instances[0];

    chatAuthExpired = true;
    const input = screen.getByLabelText("Type a message to your Hermes agent");
    await user.type(input, "hello");
    await user.click(
      screen.getByRole("button", { name: /Send typed message/ }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Private PIN")).toBeInTheDocument(),
    );
    expect(first.setHoldToTalk).toHaveBeenCalledWith(false);
    expect(first.disconnect).toHaveBeenCalledTimes(1);

    chatAuthExpired = false;
    await user.type(screen.getByLabelText("Private PIN"), "abcdefgh");
    await user.click(screen.getByRole("button", { name: /^Unlock$/ }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 2 });
    await waitFor(() => expect(realtimeMock.instances).toHaveLength(2));
    expect(first.resume).not.toHaveBeenCalled();
    expect(realtimeMock.instances[1]).not.toBe(first);
  });

  it("clears an active realtime session when realtime auth expires after connect", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    const first = realtimeMock.instances[0];

    act(() => {
      first.callbacks.onError?.(new Error('{"detail":"Session expired"} (HTTP 401)'));
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Private PIN")).toBeInTheDocument(),
    );
    expect(first.setHoldToTalk).toHaveBeenCalledWith(false);
    expect(first.disconnect).toHaveBeenCalledTimes(1);
  });

  it("ignores stale session diagnostics and close callbacks after a new call starts", async () => {
    const user = userEvent.setup();
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    const first = realtimeMock.instances[0];

    await user.click(screen.getByRole("button", { name: /End/ }));
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 2 });
    await waitFor(() => expect(realtimeMock.instances).toHaveLength(2));
    const second = realtimeMock.instances[1];

    act(() => {
      first.callbacks.onDiagnosticsEvent?.({
        name: "session_close",
        epochMs: 1,
        monotonicMs: 1,
        detail: { closeReason: "stale session" },
      });
      first.callbacks.onClose?.({});
      second.callbacks.onDiagnosticsEvent?.({
        name: "session_close",
        epochMs: 2,
        monotonicMs: 2,
        detail: { closeReason: "current session" },
      });
    });

    const snapshot = (window as any).__HVC_DIAGNOSTICS__.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain("stale session");
    expect(JSON.stringify(snapshot)).toContain("current session");

    await user.click(screen.getByRole("button", { name: /End/ }));
    expect(second.disconnect).toHaveBeenCalledTimes(1);
  });

  it("handles realtime provider factory failures as recoverable voice errors", async () => {
    realtimeMock.createError = new Error(
      "Unsupported realtime provider 'openai'.",
    );
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });

    await waitFor(() =>
      expect(
        screen.getByText(
          "Could not prepare your Hermes agent voice. Confirm you are on the private network and try again.",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Unsupported realtime provider 'openai'."),
    ).toBeInTheDocument();
    expect(realtimeMock.instances).toHaveLength(0);
  });

  it("second orb tap pauses and disables microphone capture", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 2 });

    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(
      realtimeMock.instances[0].setMicrophoneEnabled,
    ).toHaveBeenLastCalledWith(false);
    expect(realtimeMock.instances[0].setHoldToTalk).toHaveBeenLastCalledWith(
      false,
    );
  });

  it("mute toggles the realtime session microphone enabled state", async () => {
    const user = userEvent.setup();
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Mute/ }));
    expect(
      realtimeMock.instances[0].setMicrophoneEnabled,
    ).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("button", { name: /Unmute/ }));
    expect(
      realtimeMock.instances[0].setMicrophoneEnabled,
    ).toHaveBeenLastCalledWith(true);
  });

  it("text focus disables active voice capture", async () => {
    const user = userEvent.setup();
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    await user.click(
      screen.getByLabelText("Type a message to your Hermes agent"),
    );

    expect(
      realtimeMock.instances[0].setMicrophoneEnabled,
    ).toHaveBeenLastCalledWith(false);
    expect(realtimeMock.instances[0].setHoldToTalk).toHaveBeenLastCalledWith(
      false,
    );
  });

  it("leaves thinking state when text focus abandons a pending hold turn", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerUp(orb, { pointerId: 2 });
    expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();

    fireEvent.focus(screen.getByLabelText("Type a message to your Hermes agent"));

    expect(
      screen.queryByText("Finishing your turn..."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Tap to talk to Hermes Agent")).toBeInTheDocument();

    act(() => realtimeMock.instances[0].callbacks.onStatus("turn-complete"));

    expect(
      screen.queryByText("Finishing your turn..."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("I didn't catch that.")).not.toBeInTheDocument();
  });

  it("long orb hold recovers when no speech or response arrives", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    expect(screen.getByText("Holding to talk")).toBeInTheDocument();
    expect(realtimeMock.instances[0].setHoldToTalk).toHaveBeenLastCalledWith(
      true,
    );

    fireEvent.pointerUp(orb, { pointerId: 2 });
    expect(realtimeMock.instances[0].setHoldToTalk).toHaveBeenLastCalledWith(
      false,
    );
    expect(realtimeMock.instances[0].finalizeInputTurn).toHaveBeenCalledTimes(
      1,
    );
    const micCallsBeforeRecovery =
      realtimeMock.instances[0].setMicrophoneEnabled.mock.calls.length;
    expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3500));

    expect(screen.getByText("I didn't catch that.")).toBeInTheDocument();
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
    expect(
      realtimeMock.instances[0].setMicrophoneEnabled.mock.calls.length,
    ).toBeGreaterThan(micCallsBeforeRecovery);
    expect(
      realtimeMock.instances[0].setMicrophoneEnabled,
    ).toHaveBeenLastCalledWith(true);
  });

  it("does not start no-speech recovery before hold capture activates", async () => {
    realtimeMock.connectGate = createConnectGate();
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    expect(screen.getByText("Connecting voice...")).toBeInTheDocument();
    fireEvent.pointerUp(orb, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(3500));

    expect(screen.queryByText("I didn't catch that.")).not.toBeInTheDocument();
    expect(realtimeMock.instances[0].setHoldToTalk).not.toHaveBeenCalledWith(
      true,
    );

    vi.useRealTimers();
    await act(async () => {
      realtimeMock.connectGate?.resolve();
      await realtimeMock.connectGate?.promise;
    });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    expect(realtimeMock.instances[0].setHoldToTalk).not.toHaveBeenCalledWith(
      true,
    );
  });

  it("waits for provider listening before activating a first hold", async () => {
    realtimeMock.emitInitialStatuses = false;
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    expect(realtimeMock.instances).toHaveLength(1);
    await act(async () => undefined);

    fireEvent.pointerUp(orb, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(3500));

    expect(screen.queryByText("I didn't catch that.")).not.toBeInTheDocument();
    expect(realtimeMock.instances[0].setHoldToTalk).not.toHaveBeenCalledWith(
      true,
    );

    act(() => realtimeMock.instances[0].callbacks.onStatus("setup-complete"));
    expect(realtimeMock.instances[0].setHoldToTalk).not.toHaveBeenCalledWith(
      true,
    );

    act(() => realtimeMock.instances[0].callbacks.onStatus("listening"));
    expect(realtimeMock.instances[0].setHoldToTalk).not.toHaveBeenCalledWith(
      true,
    );
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
  });

  it("preserves a first hold while the initial voice session connects", async () => {
    realtimeMock.connectGate = createConnectGate();
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    expect(screen.getByText("Connecting voice...")).toBeInTheDocument();
    expect(realtimeMock.instances[0].setHoldToTalk).not.toHaveBeenCalledWith(
      true,
    );

    vi.useRealTimers();
    await act(async () => {
      realtimeMock.connectGate?.resolve();
      await realtimeMock.connectGate?.promise;
    });

    await waitFor(() =>
      expect(screen.getByText("Holding to talk")).toBeInTheDocument(),
    );
    expect(realtimeMock.instances[0].setHoldToTalk).toHaveBeenLastCalledWith(
      true,
    );
    expect(
      realtimeMock.instances[0].setMicrophoneEnabled,
    ).toHaveBeenLastCalledWith(true);

    fireEvent.pointerUp(orb, { pointerId: 1 });
    expect(realtimeMock.instances[0].finalizeInputTurn).toHaveBeenCalledTimes(
      1,
    );
    expect(
      realtimeMock.instances[0].finalizeInputTurn.mock.invocationCallOrder[0],
    ).toBeLessThan(
      realtimeMock.instances[0].setHoldToTalk.mock.invocationCallOrder.at(-1),
    );
    expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();
  });

  it("recovers immediately when the provider completes a silent hold turn", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerUp(orb, { pointerId: 2 });
    const micCallsBeforeProviderCompletion =
      realtimeMock.instances[0].setMicrophoneEnabled.mock.calls.length;
    act(() => realtimeMock.instances[0].callbacks.onStatus("turn-complete"));

    expect(screen.getByText("I didn't catch that.")).toBeInTheDocument();
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
    expect(
      realtimeMock.instances[0].setMicrophoneEnabled.mock.calls.length,
    ).toBeGreaterThan(micCallsBeforeProviderCompletion);
    expect(
      realtimeMock.instances[0].setMicrophoneEnabled,
    ).toHaveBeenLastCalledWith(true);
  });

  it("cancels stale turn recovery when retrying with a new hold", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerUp(orb, { pointerId: 2 });
    expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    fireEvent.pointerDown(orb, { pointerId: 3, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    expect(screen.getByText("Holding to talk")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3500));
    expect(screen.queryByText("I didn't catch that.")).not.toBeInTheDocument();
    expect(screen.getByText("Holding to talk")).toBeInTheDocument();

    fireEvent.pointerUp(orb, { pointerId: 3 });
    act(() => vi.advanceTimersByTime(3500));

    expect(screen.getAllByText("I didn't catch that.")).toHaveLength(1);
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
  });

  it("ignores a stale provider turn-complete after retrying a hold", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerUp(orb, { pointerId: 2 });
    expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    fireEvent.pointerDown(orb, { pointerId: 3, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerUp(orb, { pointerId: 3 });
    act(() => realtimeMock.instances[0].callbacks.onStatus("turn-complete"));

    expect(screen.queryByText("I didn't catch that.")).not.toBeInTheDocument();
    expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3500));

    expect(screen.getAllByText("I didn't catch that.")).toHaveLength(1);
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
  });

  it("does not spend the next turn-complete after abandoning a hold with no finalized audio", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    const session = realtimeMock.instances[0];
    session.finalizeInputTurn
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerUp(orb, { pointerId: 2 });
    expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    fireEvent.pointerDown(orb, { pointerId: 3, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerUp(orb, { pointerId: 3 });
    act(() => realtimeMock.instances[0].callbacks.onStatus("turn-complete"));

    expect(screen.getByText("I didn't catch that.")).toBeInTheDocument();
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
  });

  it("ignores stale agent callbacks after abandoning a hold for text input", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    const session = realtimeMock.instances[0];

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerUp(orb, { pointerId: 2 });
    fireEvent.focus(screen.getByLabelText("Type a message to your Hermes agent"));

    act(() => session.callbacks.onStatus("agent-speaking"));
    act(() =>
      session.callbacks.onTranscript({
        role: "agent",
        text: "old abandoned answer",
        final: true,
      }),
    );
    act(() =>
      session.callbacks.onToolCall({
        id: "old-tool",
        name: "ask_agent",
        args: { message: "old" },
      }),
    );

    expect(session.abandonPendingResponse).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Hermes Agent is speaking")).not.toBeInTheDocument();
    expect(screen.queryByText("old abandoned answer")).not.toBeInTheDocument();
    expect(screen.getByText("Tap to talk to Hermes Agent")).toBeInTheDocument();

    act(() => session.callbacks.onStatus("turn-complete"));
    expect(screen.queryByText("I didn't catch that.")).not.toBeInTheDocument();
  });

  it("ignores a stale provider completion after a timed-out hold is retried", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    const session = realtimeMock.instances[0];

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerUp(orb, { pointerId: 2 });
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.getAllByText("I didn't catch that.")).toHaveLength(1);
    expect(session.abandonPendingResponse).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(orb, { pointerId: 3, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerUp(orb, { pointerId: 3 });
    act(() => session.callbacks.onStatus("turn-complete"));

    expect(screen.getAllByText("I didn't catch that.")).toHaveLength(1);
    expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3500));
    expect(screen.getAllByText("I didn't catch that.")).toHaveLength(2);
  });

  it("accepts a quick retry response before the abandoned provider turn completes", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    const session = realtimeMock.instances[0];

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerUp(orb, { pointerId: 2 });
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.getAllByText("I didn't catch that.")).toHaveLength(1);
    expect(session.abandonPendingResponse).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(orb, { pointerId: 3, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerUp(orb, { pointerId: 3 });
    expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();

    act(() => session.callbacks.onStatus("agent-speaking"));

    expect(screen.getByText("Hermes Agent is speaking")).toBeInTheDocument();
    expect(screen.getAllByText("I didn't catch that.")).toHaveLength(1);

    act(() => session.callbacks.onStatus("turn-complete"));

    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
    expect(screen.getAllByText("I didn't catch that.")).toHaveLength(1);
  });

  it("finalizes and suppresses an activated hold when pointer capture is cancelled", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    const session = realtimeMock.instances[0];

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    fireEvent.pointerCancel(orb, { pointerId: 2 });

    expect(session.finalizeInputTurn).toHaveBeenCalledTimes(1);
    expect(session.finalizeInputTurn.mock.invocationCallOrder[0]).toBeLessThan(
      session.setHoldToTalk.mock.invocationCallOrder.at(-1),
    );
    expect(session.abandonPendingResponse).toHaveBeenCalledTimes(1);
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
  });

  it("keeps streaming user transcription visible in the transcript drawer", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    act(() => {
      realtimeMock.instances[0].callbacks.onTranscript?.({
        role: "user",
        text: "turn on the lights",
        final: false,
      });
    });

    expect(screen.getByLabelText("Live transcript")).toHaveTextContent(
      "turn on the lights",
    );
    expect(screen.getByText("live")).toBeInTheDocument();

    act(() => {
      realtimeMock.instances[0].callbacks.onTranscript?.({
        role: "user",
        text: "turn on the lights please",
        final: true,
      });
    });

    expect(screen.queryByLabelText("Live transcript")).not.toBeInTheDocument();
    expect(screen.getByText("turn on the lights please")).toBeInTheDocument();
  });

  it("starts a fresh transcript row after abandoning a partial user draft", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    act(() => {
      realtimeMock.instances[0].callbacks.onTranscript?.({
        role: "user",
        text: "turn on",
        final: false,
      });
    });
    expect(screen.getAllByText("turn on")).toHaveLength(2);

    fireEvent.focus(screen.getByLabelText("Type a message to your Hermes agent"));
    expect(screen.queryByLabelText("Live transcript")).not.toBeInTheDocument();

    act(() => {
      realtimeMock.instances[0].callbacks.onTranscript?.({
        role: "user",
        text: "turn off",
        final: false,
      });
    });

    expect(screen.getByText("turn on")).toBeInTheDocument();
    expect(screen.getByText("cancelled")).toBeInTheDocument();
    expect(screen.getAllByText("turn off")).toHaveLength(2);
  });

  it("does not treat speech captured before hold release as silence", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    act(() => {
      realtimeMock.instances[0].callbacks.onTranscript?.({
        role: "user",
        text: "open the garage",
        final: false,
      });
    });

    fireEvent.pointerUp(orb, { pointerId: 2 });
    act(() => vi.advanceTimersByTime(3500));

    expect(screen.queryByText("I didn't catch that.")).not.toBeInTheDocument();
    expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();

    act(() => realtimeMock.instances[0].callbacks.onStatus("turn-complete"));

    expect(
      screen.getByText(
        "I heard you, but Hermes Agent did not return a response.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
  });

  it("ends a completed tool turn with no agent output on provider completion", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    act(() => {
      realtimeMock.instances[0].callbacks.onTranscript?.({
        role: "user",
        text: "check the house",
        final: true,
      });
    });
    fireEvent.pointerUp(orb, { pointerId: 2 });
    act(() => {
      realtimeMock.instances[0].callbacks.onToolCall?.({
        id: "tool-done-no-output",
        name: "ask_agent",
        args: { message: "check the house" },
      });
      realtimeMock.instances[0].callbacks.onToolResponse?.({
        id: "tool-done-no-output",
        name: "ask_agent",
        response: { status: "completed" },
      });
      realtimeMock.instances[0].callbacks.onStatus("turn-complete");
    });

    expect(
      screen.getByText(/I heard you, but Hermes Agent did not return a response/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Listening hands-free")).toBeInTheDocument();
  });

  it("does not fail slow tool-backed hold responses at the first response timeout", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));
    act(() => {
      realtimeMock.instances[0].callbacks.onTranscript?.({
        role: "user",
        text: "check the house",
        final: true,
      });
    });
    fireEvent.pointerUp(orb, { pointerId: 2 });
    act(() => {
      realtimeMock.instances[0].callbacks.onToolCall?.({
        id: "tool-slow",
        name: "ask_agent",
        args: { message: "check the house" },
      });
    });
    act(() => realtimeMock.instances[0].callbacks.onStatus("turn-complete"));

    expect(
      screen.queryByText(/did not return a response/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(14000));

    expect(
      screen.queryByText(/did not return a response/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Finishing your turn...")).toBeInTheDocument();

    act(() => {
      realtimeMock.instances[0].callbacks.onToolResponse?.({
        id: "tool-slow",
        name: "ask_agent",
        response: { status: "completed" },
      });
      realtimeMock.instances[0].callbacks.onStatus("agent-speaking");
    });

    expect(
      screen.queryByText(/did not return a response/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Hermes Agent is speaking")).toBeInTheDocument();
  });

  it("keeps raw realtime tool activity out of the transcript", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    act(() => {
      realtimeMock.instances[0].callbacks.onToolCall?.({
        id: "tool-1",
        name: "ask_agent",
        args: { message: "hi" },
      });
      realtimeMock.instances[0].callbacks.onToolResponse?.({
        id: "tool-1",
        name: "ask_agent",
        response: { status: "completed" },
      });
    });

    expect(screen.queryByText(/using ask_agent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ask_agent finished/i)).not.toBeInTheDocument();
  });

  it("long hold while the agent is speaking interrupts playback", async () => {
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    act(() => realtimeMock.instances[0].callbacks.onStatus("agent-speaking"));
    await waitFor(() =>
      expect(screen.getByText("Hermes Agent is speaking")).toBeInTheDocument(),
    );

    vi.useFakeTimers();
    fireEvent.pointerDown(orb, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(230));

    expect(realtimeMock.instances[0].interrupt).toHaveBeenCalledTimes(1);
    expect(realtimeMock.instances[0].setHoldToTalk).toHaveBeenLastCalledWith(
      true,
    );
  });

  it("End disconnects the realtime session and returns to idle", async () => {
    const user = userEvent.setup();
    await renderUnlockedApp();
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /End/ }));

    expect(realtimeMock.instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Tap to talk to Hermes Agent")).toBeInTheDocument();
  });
});
