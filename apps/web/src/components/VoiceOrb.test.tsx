import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceState } from "../types";
import { VoiceOrb } from "./VoiceOrb";

const baseState: VoiceState = {
  callState: "listening",
  inputMode: "hands-free",
  drawer: "closed",
  isMuted: false,
  partialTranscript: "",
};

describe("VoiceOrb", () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let rafId: number;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;
  let originalMatchMedia: typeof window.matchMedia | undefined;
  let reducedMotion: boolean;

  beforeEach(() => {
    callbacks = new Map();
    rafId = 0;
    reducedMotion = false;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    originalMatchMedia = window.matchMedia;
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafId += 1;
      callbacks.set(rafId, callback);
      return rafId;
    });
    window.cancelAnimationFrame = vi.fn((id: number) => {
      callbacks.delete(id);
    });
    window.matchMedia = vi.fn((query: string) => {
      return {
        matches: reducedMotion,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList;
    });
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
    else Reflect.deleteProperty(window, "matchMedia");
    vi.restoreAllMocks();
  });

  it("writes a smoothed orb level while an active state is visible", () => {
    const levelRef = { current: 0.8 };
    render(
      <VoiceOrb
        state={baseState}
        mode="live"
        agentName="Hermes Agent"
        onPointerDown={vi.fn()}
        onPointerUp={vi.fn()}
        onPointerCancel={vi.fn()}
        onRetry={vi.fn()}
        audioLevelRef={levelRef}
      />,
    );

    const orb = screen.getByRole("button", { name: /Voice orb:/ });
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    act(() => callbacks.get(1)?.(0));

    expect(Number(orb.style.getPropertyValue("--orb-level"))).toBeGreaterThan(0);
    expect(levelRef.current).toBeCloseTo(0.672, 3);
  });

  it("stops the rAF loop and clears the level outside active states", () => {
    const levelRef = { current: 0.8 };
    const { rerender } = render(
      <VoiceOrb
        state={baseState}
        mode="live"
        agentName="Hermes Agent"
        onPointerDown={vi.fn()}
        onPointerUp={vi.fn()}
        onPointerCancel={vi.fn()}
        onRetry={vi.fn()}
        audioLevelRef={levelRef}
      />,
    );

    act(() => callbacks.get(1)?.(0));
    rerender(
      <VoiceOrb
        state={{ ...baseState, callState: "idle" }}
        mode="live"
        agentName="Hermes Agent"
        onPointerDown={vi.fn()}
        onPointerUp={vi.fn()}
        onPointerCancel={vi.fn()}
        onRetry={vi.fn()}
        audioLevelRef={levelRef}
      />,
    );

    const orb = screen.getByRole("button", { name: /Voice orb:/ });
    expect(orb.style.getPropertyValue("--orb-level")).toBe("0");
    expect(levelRef.current).toBe(0);
  });

  it("does not run the orb level loop when reduced motion is requested", () => {
    reducedMotion = true;
    const levelRef = { current: 0.8 };
    render(
      <VoiceOrb
        state={baseState}
        mode="live"
        agentName="Hermes Agent"
        onPointerDown={vi.fn()}
        onPointerUp={vi.fn()}
        onPointerCancel={vi.fn()}
        onRetry={vi.fn()}
        audioLevelRef={levelRef}
      />,
    );

    const orb = screen.getByRole("button", { name: /Voice orb:/ });
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(orb.style.getPropertyValue("--orb-level")).toBe("0");
    expect(levelRef.current).toBe(0);
  });
});
