import { afterEach, describe, expect, it, vi } from "vitest";
import { createEarconController } from "./earcons";

class FakeAudioParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class FakeOscillator {
  type: OscillatorType = "sine";
  frequency = new FakeAudioParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeGain {
  gain = new FakeAudioParam();
  connect = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 10;
  destination = {};
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => undefined);

  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator as unknown as OscillatorNode;
  }

  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }
}

describe("earcons", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not schedule audio until unlocked by a user gesture", async () => {
    const context = new FakeAudioContext();
    const controller = createEarconController({
      AudioContextCtor: function () {
        return context;
      } as unknown as typeof AudioContext,
    });

    controller.play("send");
    expect(context.oscillators).toHaveLength(0);

    await controller.unlock();
    controller.play("send");

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators[0].start).toHaveBeenCalledWith(10);
    expect(context.oscillators[1].start).toHaveBeenCalledWith(10.062);

    controller.close();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("allows first-gesture playback while resume is still settling", async () => {
    let resume!: () => void;
    const context = new FakeAudioContext();
    context.resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resume = resolve;
        }),
    );
    const controller = createEarconController({
      AudioContextCtor: function () {
        return context;
      } as unknown as typeof AudioContext,
    });

    const unlocking = controller.unlock();
    controller.play("send");

    expect(context.oscillators).toHaveLength(2);
    resume();
    await unlocking;
  });

  it("keeps unlock as a no-op when AudioContext construction fails", async () => {
    class ThrowingAudioContext {
      constructor() {
        throw new Error("audio context quota exceeded");
      }
    }
    const controller = createEarconController({
      AudioContextCtor:
        ThrowingAudioContext as unknown as typeof AudioContext,
    });

    await expect(controller.unlock()).resolves.toBeUndefined();
    expect(() => controller.play("send")).not.toThrow();
  });
});
