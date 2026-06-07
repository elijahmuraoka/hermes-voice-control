import { describe, expect, it } from "vitest";
import {
  decodeGeminiOutputForPlayback,
  decodePcm16Base64,
  encodePcm16Base64,
  resampleLinear,
} from "./audio";

describe("audio helpers", () => {
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
});
