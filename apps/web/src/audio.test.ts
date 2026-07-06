import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserGeminiAudio,
  decodeGeminiOutputForPlayback,
  decodePcm16Base64,
  encodePcm16Base64,
  resampleLinear,
} from "./audio";

class FakeAudioContext {
  state = "running";
  sampleRate = 48000;
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => undefined) };
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  close = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);
}

describe("audio helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes and decodes little-endian pcm16 base64", () => {
    const encoded = encodePcm16Base64(
      new Float32Array([-1, 0, 1]),
      16000,
      16000,
    );
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));

    expect(Array.from(bytes)).toEqual([0, 128, 0, 0, 255, 127]);
    expect(Array.from(decodePcm16Base64(encoded))).toEqual([-1, 0, 1]);
  });

  it("resamples capture audio to 16kHz", () => {
    const input = new Float32Array(480);
    const resampled = resampleLinear(input, 48000, 16000);

    expect(resampled.length).toBe(160);
  });

  it("resamples 24kHz Gemini output to the playback context rate", () => {
    const encoded = encodePcm16Base64(
      new Float32Array([0, 0.25, 0.5, 0.75]),
      24000,
      24000,
    );
    const playback = decodeGeminiOutputForPlayback(encoded, 48000, 24000);

    expect(playback.length).toBe(8);
    expect(playback[0]).toBeCloseTo(0);
    expect(playback[2]).toBeCloseTo(0.25, 4);
  });

  it("stops late microphone tracks when closed during getUserMedia", async () => {
    let resolveStream!: (stream: MediaStream) => void;
    const stop = vi.fn();
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        }),
    );
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        port = { onmessage: null };
        disconnect = vi.fn();
      },
    );
    const audio = new BrowserGeminiAudio({
      mediaDevices: { getUserMedia } as unknown as MediaDevices,
      AudioContextCtor: FakeAudioContext as unknown as typeof AudioContext,
    });

    const start = audio.startCapture(vi.fn());
    audio.close();
    resolveStream({
      getTracks: () => [{ stop }],
    } as unknown as MediaStream);
    await start;

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stops microphone tracks when AudioContext construction fails", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop }],
    })) as unknown as MediaDevices["getUserMedia"];
    class ThrowingAudioContext {
      constructor() {
        throw new Error("audio context quota exceeded");
      }
    }
    const audio = new BrowserGeminiAudio({
      mediaDevices: { getUserMedia } as unknown as MediaDevices,
      AudioContextCtor: ThrowingAudioContext as unknown as typeof AudioContext,
    });

    await expect(audio.startCapture(vi.fn())).rejects.toThrow(
      /audio context quota exceeded/i,
    );

    expect(stop).toHaveBeenCalledTimes(1);
  });
});
