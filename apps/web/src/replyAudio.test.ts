import { afterEach, describe, expect, it, vi } from "vitest";
import { createReplyAudioController } from "./replyAudio";

class FakeBufferSource {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = "running";
  destination = {};
  sources: FakeBufferSource[] = [];
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);

  createBufferSource() {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
}

describe("reply audio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not start decoded audio after a stop request invalidates playback", async () => {
    let resolveDecode!: (buffer: AudioBuffer) => void;
    const context = new FakeAudioContext();
    context.decodeAudioData = vi.fn(
      () =>
        new Promise<AudioBuffer>((resolve) => {
          resolveDecode = resolve;
        }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]).buffer)),
    );
    const controller = createReplyAudioController({
      AudioContextCtor: function () {
        return context;
      } as unknown as typeof AudioContext,
    });
    let current = true;

    const playing = controller.playDataUrl(
      "data:audio/mpeg;base64,AAECAw==",
      vi.fn(),
      () => current,
    );
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalled());

    current = false;
    controller.stop();
    resolveDecode({} as AudioBuffer);

    await expect(playing).resolves.toBe(false);
    expect(context.sources).toHaveLength(0);
  });

  it("does not stop newer playback when an older attempt fails late", async () => {
    let rejectFirst!: (error: Error) => void;
    let fetchCalls = 0;
    const context = new FakeAudioContext();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return await new Promise<Response>((_resolve, reject) => {
            rejectFirst = reject;
          });
        }
        return new Response(new Uint8Array([1, 2, 3]).buffer);
      }),
    );
    const controller = createReplyAudioController({
      AudioContextCtor: function () {
        return context;
      } as unknown as typeof AudioContext,
    });

    const first = controller.playDataUrl("data:audio/mpeg;base64,old");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await expect(
      controller.playDataUrl("data:audio/mpeg;base64,new"),
    ).resolves.toBe(true);
    expect(context.sources).toHaveLength(1);
    const activeSource = context.sources[0];

    rejectFirst(new Error("old reply failed"));
    await expect(first).resolves.toBe(false);
    expect(activeSource.start).toHaveBeenCalledTimes(1);
    expect(activeSource.stop).not.toHaveBeenCalled();
  });
});
