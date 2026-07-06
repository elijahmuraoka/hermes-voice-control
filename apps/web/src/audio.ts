export const GEMINI_INPUT_SAMPLE_RATE = 16000;
export const GEMINI_OUTPUT_SAMPLE_RATE = 24000;
export const GEMINI_INPUT_MIME_TYPE = "audio/pcm;rate=16000";

export interface PcmChunk {
  data: string;
  mimeType: typeof GEMINI_INPUT_MIME_TYPE;
}

export type AudioLevelCallback = (level: number) => void;

export interface GeminiLiveAudio {
  startCapture(onChunk: (chunk: PcmChunk) => void): Promise<void>;
  stopCapture(): void;
  setCaptureEnabled(enabled: boolean): void;
  playPcm16Base64(base64: string, sourceSampleRate?: number): Promise<void>;
  resume(): Promise<void>;
  interrupt(): void;
  close(): void;
}

export interface BrowserGeminiAudioOptions {
  captureWorkletUrl?: string;
  playbackWorkletUrl?: string;
  mediaDevices?: MediaDevices;
  AudioContextCtor?: typeof AudioContext;
  onInputLevel?: AudioLevelCallback;
  onOutputLevel?: AudioLevelCallback;
}

const DEFAULT_CAPTURE_WORKLET = "/audio-processors/capture.worklet.js";
const DEFAULT_PLAYBACK_WORKLET = "/audio-processors/playback.worklet.js";

export function resampleLinear(
  input: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  if (sourceRate <= 0 || targetRate <= 0)
    throw new Error("Sample rates must be positive");
  if (input.length === 0) return new Float32Array();
  if (sourceRate === targetRate) return new Float32Array(input);

  const outputLength = Math.max(
    1,
    Math.round((input.length * targetRate) / sourceRate),
  );
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const low = Math.floor(sourceIndex);
    const high = Math.min(low + 1, input.length - 1);
    const fraction = sourceIndex - low;
    output[i] = input[low] + (input[high] - input[low]) * fraction;
  }

  return output;
}

export function encodePcm16Base64(
  input: Float32Array,
  sourceRate: number,
  targetRate = GEMINI_INPUT_SAMPLE_RATE,
): string {
  const resampled = resampleLinear(input, sourceRate, targetRate);
  const bytes = new Uint8Array(resampled.length * 2);
  const view = new DataView(bytes.buffer);

  for (let i = 0; i < resampled.length; i++) {
    const clamped = Math.max(-1, Math.min(1, resampled[i]));
    const sample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(i * 2, Math.round(sample), true);
  }

  return uint8ToBase64(bytes);
}

export function decodePcm16Base64(base64: string): Float32Array {
  const bytes = base64ToUint8(base64);
  if (bytes.byteLength % 2 !== 0)
    throw new Error("PCM16 payload must have an even byte length");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 2);

  for (let i = 0; i < samples.length; i++) {
    const value = view.getInt16(i * 2, true);
    samples[i] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }

  return samples;
}

export function decodeGeminiOutputForPlayback(
  base64: string,
  playbackSampleRate: number,
  sourceSampleRate = GEMINI_OUTPUT_SAMPLE_RATE,
): Float32Array {
  return resampleLinear(
    decodePcm16Base64(base64),
    sourceSampleRate,
    playbackSampleRate,
  );
}

export function computeAudioLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  return Math.max(0, Math.min(1, rms * 4.8));
}

export class BrowserGeminiAudio implements GeminiLiveAudio {
  private readonly captureWorkletUrl: string;
  private readonly playbackWorkletUrl: string;
  private readonly mediaDevices?: MediaDevices;
  private readonly AudioContextCtor: typeof AudioContext;
  private readonly onInputLevel?: AudioLevelCallback;
  private readonly onOutputLevel?: AudioLevelCallback;
  private captureContext?: AudioContext;
  private playbackContext?: AudioContext;
  private captureNode?: AudioWorkletNode;
  private playbackNode?: AudioWorkletNode;
  private inputAnalyser?: AnalyserNode;
  private inputLevelSamples?: Float32Array<ArrayBuffer>;
  private inputLevelRaf: number | null = null;
  private outputLevelTimers = new Set<number>();
  private outputLevelTailMs = 0;
  private mediaStream?: MediaStream;
  private captureEnabled = true;
  private closed = false;
<<<<<<< HEAD
  private readonly visibilityHandler = () => {
    if (document.visibilityState === "hidden") {
      this.stopInputLevelMeter();
      this.onInputLevel?.(0);
      return;
    }
    this.startInputLevelMeter();
  };
=======
>>>>>>> origin/main

  constructor(options: BrowserGeminiAudioOptions = {}) {
    const AudioContextCtor =
      options.AudioContextCtor ?? globalThis.AudioContext;
    if (!AudioContextCtor)
      throw new Error("AudioContext is not available in this browser");
    this.AudioContextCtor = AudioContextCtor;
    this.mediaDevices = options.mediaDevices ?? navigator.mediaDevices;
    this.onInputLevel = options.onInputLevel;
    this.onOutputLevel = options.onOutputLevel;
    this.captureWorkletUrl =
      options.captureWorkletUrl ?? DEFAULT_CAPTURE_WORKLET;
    this.playbackWorkletUrl =
      options.playbackWorkletUrl ?? DEFAULT_PLAYBACK_WORKLET;
  }

  async startCapture(onChunk: (chunk: PcmChunk) => void): Promise<void> {
    if (this.closed) return;
    if (this.captureNode) return;
    if (!this.mediaDevices)
      throw new Error("MediaDevices is not available in this browser");

    const mediaStream = await this.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (this.closed) {
      mediaStream.getTracks().forEach((track) => track.stop());
      return;
    }
    let captureContext: AudioContext;
    try {
      captureContext = new this.AudioContextCtor();
    } catch (error) {
      mediaStream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    try {
      await captureContext.audioWorklet.addModule(this.captureWorkletUrl);
    } catch (error) {
      mediaStream.getTracks().forEach((track) => track.stop());
      void captureContext.close();
      throw error;
    }
    if (this.closed) {
      mediaStream.getTracks().forEach((track) => track.stop());
      void captureContext.close();
      return;
    }
    this.mediaStream = mediaStream;
    this.captureContext = captureContext;

<<<<<<< HEAD
    const source = this.captureContext.createMediaStreamSource(
      this.mediaStream,
    );
    if (this.onInputLevel) {
      this.inputAnalyser = this.captureContext.createAnalyser();
      this.inputAnalyser.fftSize = 1024;
      this.inputLevelSamples = new Float32Array(this.inputAnalyser.fftSize);
      source.connect(this.inputAnalyser);
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", this.visibilityHandler);
      }
    }
=======
    const source = this.captureContext.createMediaStreamSource(this.mediaStream);
>>>>>>> origin/main
    this.captureNode = new AudioWorkletNode(
      this.captureContext,
      "audio-capture-processor",
      {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      },
    );
    this.captureNode.port.onmessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string; data?: unknown };
      if (
        !this.captureEnabled ||
        payload?.type !== "audio" ||
        !(payload.data instanceof Float32Array)
      )
        return;
      onChunk({
        data: encodePcm16Base64(
          payload.data,
          this.captureContext?.sampleRate ?? GEMINI_INPUT_SAMPLE_RATE,
        ),
        mimeType: GEMINI_INPUT_MIME_TYPE,
      });
    };
    source.connect(this.captureNode);
    this.startInputLevelMeter();
  }

  stopCapture(): void {
    this.stopInputLevelMeter();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.onInputLevel?.(0);
    this.inputAnalyser?.disconnect();
    this.inputAnalyser = undefined;
    this.inputLevelSamples = undefined;
    this.captureNode?.disconnect();
    this.captureNode = undefined;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = undefined;
    void this.captureContext?.close();
    this.captureContext = undefined;
  }

  setCaptureEnabled(enabled: boolean): void {
    this.captureEnabled = enabled;
    if (enabled) {
      this.startInputLevelMeter();
    } else {
      this.stopInputLevelMeter();
      this.onInputLevel?.(0);
    }
  }

  async playPcm16Base64(
    base64: string,
    sourceSampleRate = GEMINI_OUTPUT_SAMPLE_RATE,
  ): Promise<void> {
    const node = await this.ensurePlaybackNode();
    const playbackSampleRate =
      this.playbackContext?.sampleRate ?? sourceSampleRate;
    const samples = decodeGeminiOutputForPlayback(
      base64,
      playbackSampleRate,
      sourceSampleRate,
    );
    this.scheduleOutputLevel(samples, playbackSampleRate);
    node.port.postMessage(samples, [samples.buffer]);
  }

  async resume(): Promise<void> {
    await Promise.all([
      resumeAudioContext(this.captureContext),
      resumeAudioContext(this.playbackContext),
    ]);
  }

  interrupt(): void {
    this.playbackNode?.port.postMessage("interrupt");
    this.clearOutputLevelMeter();
  }

  close(): void {
    this.closed = true;
    this.stopCapture();
    this.interrupt();
    this.playbackNode?.disconnect();
    this.playbackNode = undefined;
    void this.playbackContext?.close();
    this.playbackContext = undefined;
  }

  private async ensurePlaybackNode(): Promise<AudioWorkletNode> {
    if (this.playbackNode) return this.playbackNode;
    this.playbackContext = new this.AudioContextCtor();
    await this.playbackContext.audioWorklet.addModule(this.playbackWorkletUrl);
    this.playbackNode = new AudioWorkletNode(
      this.playbackContext,
      "pcm-playback-processor",
      {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      },
    );
    this.playbackNode.connect(this.playbackContext.destination);
    return this.playbackNode;
  }

  private startInputLevelMeter(): void {
    if (
      !this.onInputLevel ||
      !this.inputAnalyser ||
      !this.inputLevelSamples ||
      !this.captureEnabled ||
      this.inputLevelRaf !== null ||
      (typeof document !== "undefined" && document.visibilityState === "hidden")
    )
      return;
    const tick = () => {
      if (
        !this.onInputLevel ||
        !this.inputAnalyser ||
        !this.inputLevelSamples ||
        !this.captureEnabled ||
        (typeof document !== "undefined" && document.visibilityState === "hidden")
      ) {
        this.inputLevelRaf = null;
        return;
      }
      this.inputAnalyser.getFloatTimeDomainData(this.inputLevelSamples);
      this.onInputLevel(computeAudioLevel(this.inputLevelSamples));
      this.inputLevelRaf = window.requestAnimationFrame(tick);
    };
    this.inputLevelRaf = window.requestAnimationFrame(tick);
  }

  private stopInputLevelMeter(): void {
    if (this.inputLevelRaf === null) return;
    window.cancelAnimationFrame(this.inputLevelRaf);
    this.inputLevelRaf = null;
  }

  private scheduleOutputLevel(
    samples: Float32Array,
    playbackSampleRate: number,
  ): void {
    if (!this.onOutputLevel || samples.length === 0 || playbackSampleRate <= 0)
      return;

    const segmentMs = 80;
    const now = performance.now();
    const startAt = Math.max(now, this.outputLevelTailMs);
    const startDelayMs = Math.max(0, startAt - now);
    const samplesPerSegment = Math.max(
      1,
      Math.round((playbackSampleRate * segmentMs) / 1000),
    );
    const durationMs = (samples.length / playbackSampleRate) * 1000;
    this.outputLevelTailMs = startAt + durationMs;

    for (let offset = 0; offset < samples.length; offset += samplesPerSegment) {
      const segmentIndex = Math.floor(offset / samplesPerSegment);
      const level = computeAudioLevel(
        samples.subarray(
          offset,
          Math.min(offset + samplesPerSegment, samples.length),
        ),
      );
      this.setOutputLevelTimer(startDelayMs + segmentIndex * segmentMs, () => {
        this.onOutputLevel?.(level);
      });
    }

    const expectedTail = this.outputLevelTailMs;
    this.setOutputLevelTimer(startDelayMs + durationMs + segmentMs, () => {
      if (this.outputLevelTailMs <= expectedTail) {
        this.outputLevelTailMs = 0;
        this.onOutputLevel?.(0);
      }
    });
  }

  private setOutputLevelTimer(delayMs: number, callback: () => void): void {
    const timer = window.setTimeout(() => {
      this.outputLevelTimers.delete(timer);
      if (!this.closed) callback();
    }, delayMs);
    this.outputLevelTimers.add(timer);
  }

  private clearOutputLevelMeter(): void {
    for (const timer of this.outputLevelTimers) window.clearTimeout(timer);
    this.outputLevelTimers.clear();
    this.outputLevelTailMs = 0;
    this.onOutputLevel?.(0);
  }
}

async function resumeAudioContext(context?: AudioContext): Promise<void> {
  const state = context?.state as AudioContextState | "interrupted" | undefined;
  if (!context || (state !== "suspended" && state !== "interrupted")) return;
  await context.resume();
}

async function resumeAudioContext(context?: AudioContext): Promise<void> {
  const state = context?.state as AudioContextState | "interrupted" | undefined;
  if (!context || (state !== "suspended" && state !== "interrupted")) return;
  await context.resume();
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
