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
  createError: null as Error | null,
}));

vi.mock("./realtime", () => {
  class MockRealtimeVoiceSession {
    callbacks: any;
    connect = vi.fn(async () => {
      this.callbacks.onToken?.({
        expires_at: "2026-01-01T00:00:00Z",
        mode: "test",
        provider: "gemini",
      });
      this.callbacks.onStatus?.("setup-complete");
      this.callbacks.onStatus?.("listening");
    });
    disconnect = vi.fn();
    setMicrophoneEnabled = vi.fn();
    setHoldToTalk = vi.fn();
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
    realtimeMock.createError = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/chat/text")) {
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

  it("renders premium voice surface and transcript toggle", () => {
    render(<App />);
    expect(screen.getByText("Hermes Agent")).toBeInTheDocument();
    expect(screen.getByLabelText(/Voice orb/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Toggle transcript/ }),
    ).toBeInTheDocument();
  });

  it("does not show default PIN or interrupt controls", () => {
    render(<App />);
    expect(screen.queryByLabelText(/Private PIN/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Interrupt/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps text fallback available through the backend", async () => {
    const user = userEvent.setup();
    render(<App />);
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

  it("first orb tap constructs and connects one realtime session, then shows token mode and listening status", async () => {
    render(<App />);
    const orb = screen.getByLabelText(/Voice orb/);

    fireEvent.pointerDown(orb, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { pointerId: 1 });

    await waitFor(() =>
      expect(screen.getByText("Listening hands-free")).toBeInTheDocument(),
    );
    expect(screen.getByText("test voice")).toBeInTheDocument();
    expect(realtimeMock.instances).toHaveLength(1);
    expect(realtimeMock.instances[0].connect).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/gemini/ephemeral-token"),
      expect.anything(),
    );
  });

  it("handles realtime provider factory failures as recoverable voice errors", async () => {
    realtimeMock.createError = new Error("Unsupported realtime provider 'openai'.");
    render(<App />);
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
    render(<App />);
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
    render(<App />);
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
    render(<App />);
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

  it("long orb hold sets hold-to-talk true and release sets it false", async () => {
    render(<App />);
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
    expect(screen.getByText("Hermes Agent is thinking...")).toBeInTheDocument();
  });

  it("long hold while the agent is speaking interrupts playback", async () => {
    render(<App />);
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
    render(<App />);
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
