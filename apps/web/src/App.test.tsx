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
        if (requestUrl.includes("/chat/text")) {
          if (chatAuthExpired) {
            return new Response(JSON.stringify({ detail: "Session expired" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({
              status: "ok",
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

  it("renders premium voice surface and transcript toggle", async () => {
    await renderUnlockedApp();
    expect(screen.getByText("Hermes Agent")).toBeInTheDocument();
    expect(screen.getByLabelText(/Voice orb/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Toggle transcript/ }),
    ).toBeInTheDocument();
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

  it("keeps text fallback available through the backend", async () => {
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
