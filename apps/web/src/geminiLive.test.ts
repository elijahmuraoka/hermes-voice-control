import { describe, expect, it, vi } from "vitest";
import {
  GEMINI_INPUT_MIME_TYPE,
  type GeminiLiveAudio,
  type PcmChunk,
} from "./audio";
import { buildGeminiLiveUrl, GeminiLiveSession } from "./geminiLive";

class MockWebSocket {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  sent: unknown[] = [];

  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  receive(payload: unknown) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(payload) }),
    );
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as unknown);
  }

  close() {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }
}

class MockAudio implements GeminiLiveAudio {
  chunks: PcmChunk[] = [];
  played: Array<{ base64: string; rate?: number }> = [];
  captureEnabled: boolean[] = [];
  interrupted = 0;
  closed = 0;
  private onChunk?: (chunk: PcmChunk) => void;

  async startCapture(onChunk: (chunk: PcmChunk) => void) {
    this.onChunk = onChunk;
  }

  emit(chunk: PcmChunk) {
    this.chunks.push(chunk);
    this.onChunk?.(chunk);
  }

  stopCapture() {}

  setCaptureEnabled(enabled: boolean) {
    this.captureEnabled.push(enabled);
  }

  async playPcm16Base64(base64: string, sourceSampleRate?: number) {
    this.played.push({ base64, rate: sourceSampleRate });
  }

  interrupt() {
    this.interrupted += 1;
  }

  close() {
    this.closed += 1;
  }
}

describe("GeminiLiveSession", () => {
  it("connects with an ephemeral token and sends setup as the first websocket message", async () => {
    const ws = new MockWebSocket();
    const statuses: string[] = [];
    let url = "";
    const session = new GeminiLiveSession(
      {
        callbacks: { onStatus: (status) => statuses.push(status) },
        audio: { startCapture: false },
      },
      {
        tokenProvider: async () => ({
          token: "ephemeral/token",
          expires_at: "2026-01-01T00:00:00Z",
          mode: "real",
        }),
        webSocketFactory: (nextUrl) => {
          url = nextUrl;
          return ws;
        },
        audio: new MockAudio(),
      },
    );

    await session.connect();
    ws.open();

    expect(url).toBe(buildGeminiLiveUrl("ephemeral/token"));
    expect(ws.sent[0]).toMatchObject({
      setup: {
        model: "models/gemini-2.5-flash-native-audio-latest",
        generationConfig: { responseModalities: ["AUDIO"] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });
    expect(statuses).toEqual(["connecting", "connected"]);
  });

  it("uses the Gemini model returned with the constrained ephemeral token", async () => {
    const ws = new MockWebSocket();
    const onToken = vi.fn();
    const session = new GeminiLiveSession(
      {
        model: "gemini-client-override",
        callbacks: { onToken },
        audio: { startCapture: false },
      },
      {
        tokenProvider: async () => ({
          token: "ephemeral/token",
          expires_at: "2026-01-01T00:00:00Z",
          mode: "real",
          model: "gemini-custom-live",
        }),
        webSocketFactory: () => ws,
        audio: new MockAudio(),
      },
    );

    await session.connect();
    ws.open();

    expect(onToken).toHaveBeenCalledWith({
      expires_at: "2026-01-01T00:00:00Z",
      mode: "real",
      model: "gemini-custom-live",
    });
    expect(ws.sent[0]).toMatchObject({
      setup: { model: "models/gemini-custom-live" },
    });
  });

  it("starts capture after setupComplete and streams pcm chunks as realtime input", async () => {
    const ws = new MockWebSocket();
    const audio = new MockAudio();
    const session = new GeminiLiveSession(
      {},
      {
        tokenProvider: async () => ({
          token: "t",
          expires_at: "x",
          mode: "mock",
        }),
        webSocketFactory: () => ws,
        audio,
      },
    );

    await session.connect();
    ws.open();
    ws.receive({ setupComplete: {} });
    await Promise.resolve();
    audio.emit({ mimeType: GEMINI_INPUT_MIME_TYPE, data: "pcm" });

    expect(ws.sent.at(-1)).toEqual({
      realtimeInput: {
        mediaChunks: [{ mimeType: GEMINI_INPUT_MIME_TYPE, data: "pcm" }],
      },
    });
  });

  it("gates capture in hold-to-talk mode while keeping manual chunk sending testable", async () => {
    const ws = new MockWebSocket();
    const audio = new MockAudio();
    const session = new GeminiLiveSession(
      { audio: { holdToTalkOnly: true, startCapture: false } },
      {
        tokenProvider: async () => ({
          token: "t",
          expires_at: "x",
          mode: "mock",
        }),
        webSocketFactory: () => ws,
        audio,
      },
    );

    await session.connect();
    ws.open();
    session.sendAudioChunk({ mimeType: GEMINI_INPUT_MIME_TYPE, data: "muted" });
    session.setHoldToTalk(true);
    session.sendAudioChunk({
      mimeType: GEMINI_INPUT_MIME_TYPE,
      data: "active",
    });

    expect(audio.captureEnabled.at(-1)).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      realtimeInput: {
        mediaChunks: [{ mimeType: GEMINI_INPUT_MIME_TYPE, data: "active" }],
      },
    });

    session.setHoldToTalk(false);
    expect(ws.sent.at(-1)).toEqual({ realtimeInput: { audioStreamEnd: true } });
  });

  it("ends an open audio stream before disconnecting", async () => {
    const ws = new MockWebSocket();
    const session = new GeminiLiveSession(
      { audio: { startCapture: false } },
      {
        tokenProvider: async () => ({
          token: "t",
          expires_at: "x",
          mode: "mock",
        }),
        webSocketFactory: () => ws,
        audio: new MockAudio(),
      },
    );

    await session.connect();
    ws.open();
    session.sendAudioChunk({ mimeType: GEMINI_INPUT_MIME_TYPE, data: "pcm" });
    session.disconnect();

    expect(ws.sent.at(-1)).toEqual({ realtimeInput: { audioStreamEnd: true } });
  });

  it("plays native audio, emits transcriptions, and interrupts on barge-in signal", async () => {
    const ws = new MockWebSocket();
    const audio = new MockAudio();
    const transcript = vi.fn();
    const session = new GeminiLiveSession(
      {
        callbacks: { onTranscript: transcript },
        audio: { startCapture: false },
      },
      {
        tokenProvider: async () => ({
          token: "t",
          expires_at: "x",
          mode: "mock",
        }),
        webSocketFactory: () => ws,
        audio,
      },
    );

    await session.connect();
    ws.open();
    ws.receive({
      serverContent: {
        inputTranscription: { text: "hello", finished: true },
        outputTranscription: { text: "hi", finished: false },
        modelTurn: {
          parts: [
            { inlineData: { mimeType: "audio/pcm;rate=24000", data: "audio" } },
          ],
        },
        interrupted: true,
      },
    });
    await Promise.resolve();

    expect(transcript).toHaveBeenCalledWith({
      role: "user",
      text: "hello",
      final: true,
    });
    expect(transcript).toHaveBeenCalledWith({
      role: "model",
      text: "hi",
      final: false,
    });
    expect(audio.played).toEqual([{ base64: "audio", rate: 24000 }]);
    expect(audio.interrupted).toBe(1);
  });

  it("suppresses Gemini tool responses for canceled tool calls", async () => {
    const ws = new MockWebSocket();
    let resolveTool!: (value: unknown) => void;
    const toolResponse = new Promise((resolve) => {
      resolveTool = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const onToolResponse = vi.fn();
    const toolCaller = vi.fn((_call, context: { signal: AbortSignal }) => {
      observedSignal = context.signal;
      return toolResponse;
    });
    const toolCanceler = vi.fn(async () => ({ status: "cancelled" }));
    const session = new GeminiLiveSession(
      { callbacks: { onToolResponse }, audio: { startCapture: false } },
      {
        tokenProvider: async () => ({
          token: "t",
          expires_at: "x",
          mode: "mock",
        }),
        webSocketFactory: () => ws,
        toolCaller,
        toolCanceler,
        audio: new MockAudio(),
      },
    );

    await session.connect();
    ws.open();
    ws.receive({
      toolCall: {
        functionCalls: [
          { id: "call-canceled", name: "ask_agent", args: { message: "hi" } },
        ],
      },
    });
    await Promise.resolve();
    ws.receive({ toolCallCancellation: { ids: ["call-canceled"] } });
    resolveTool({ status: "completed", result: { display: "late" } });
    await Promise.resolve();
    await Promise.resolve();

    expect(toolCaller).toHaveBeenCalledWith(
      {
        id: "call-canceled",
        name: "ask_agent",
        args: { message: "hi" },
      },
      { signal: observedSignal },
    );
    expect(observedSignal?.aborted).toBe(true);
    expect(toolCanceler).toHaveBeenCalledWith(["call-canceled"]);
    expect(onToolResponse).not.toHaveBeenCalled();
    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toHaveProperty("setup");
  });

  it("cancels active tool calls on disconnect", async () => {
    const ws = new MockWebSocket();
    let observedSignal: AbortSignal | undefined;
    const never = new Promise(() => undefined);
    const toolCaller = vi.fn((_call, context: { signal: AbortSignal }) => {
      observedSignal = context.signal;
      return never;
    });
    const toolCanceler = vi.fn(async () => ({ status: "cancelled" }));
    const session = new GeminiLiveSession(
      { audio: { startCapture: false } },
      {
        tokenProvider: async () => ({ token: "t", expires_at: "x", mode: "mock" }),
        webSocketFactory: () => ws,
        toolCaller,
        toolCanceler,
        audio: new MockAudio(),
      },
    );

    await session.connect();
    ws.open();
    ws.receive({ toolCall: { functionCalls: [{ id: "call-active", name: "ask_agent", args: { message: "hi" } }] } });
    await Promise.resolve();
    session.disconnect();

    expect(observedSignal?.aborted).toBe(true);
    expect(toolCanceler).toHaveBeenCalledWith(["call-active"]);
  });

  it("filters previously completed responses if Gemini cancels before batch send", async () => {
    const ws = new MockWebSocket();
    let resolveSecond!: (value: unknown) => void;
    const secondResponse = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    const onToolResponse = vi.fn();
    const toolCaller = vi.fn((call) => {
      if (call.id === "call-1") return Promise.resolve({ status: "completed", result: { display: "one" } });
      return secondResponse;
    });
    const toolCanceler = vi.fn(async () => ({ status: "cancelled" }));
    const session = new GeminiLiveSession(
      { callbacks: { onToolResponse }, audio: { startCapture: false } },
      {
        tokenProvider: async () => ({ token: "t", expires_at: "x", mode: "mock" }),
        webSocketFactory: () => ws,
        toolCaller,
        toolCanceler,
        audio: new MockAudio(),
      },
    );

    await session.connect();
    ws.open();
    ws.receive({
      toolCall: {
        functionCalls: [
          { id: "call-1", name: "ask_agent", args: { message: "one" } },
          { id: "call-2", name: "ask_agent", args: { message: "two" } },
        ],
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    ws.receive({ toolCallCancellation: { ids: ["call-1"] } });
    resolveSecond({ status: "completed", result: { display: "two" } });
    await Promise.resolve();
    await Promise.resolve();

    expect(onToolResponse).toHaveBeenCalledTimes(1);
    expect(onToolResponse).toHaveBeenCalledWith({ id: "call-2", name: "ask_agent", response: { status: "completed", result: { display: "two" } } });
    expect(ws.sent.at(-1)).toEqual({
      toolResponse: {
        functionResponses: [
          { id: "call-2", name: "ask_agent", response: { status: "completed", result: { display: "two" } } },
        ],
      },
    });
  });

  it("calls backend tools and returns matching Gemini tool responses", async () => {
    const ws = new MockWebSocket();
    const toolCaller = vi.fn(async () => ({
      status: "completed",
      result: { display: "ok" },
    }));
    const session = new GeminiLiveSession(
      { audio: { startCapture: false } },
      {
        tokenProvider: async () => ({
          token: "t",
          expires_at: "x",
          mode: "mock",
        }),
        webSocketFactory: () => ws,
        toolCaller,
        audio: new MockAudio(),
      },
    );

    await session.connect();
    ws.open();
    ws.receive({
      toolCall: {
        functionCalls: [
          { id: "call-1", name: "ask_agent", args: { message: "hi" } },
        ],
      },
    });
    await Promise.resolve();

    expect(toolCaller).toHaveBeenCalledWith(
      {
        id: "call-1",
        name: "ask_agent",
        args: { message: "hi" },
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(ws.sent.at(-1)).toEqual({
      toolResponse: {
        functionResponses: [
          {
            id: "call-1",
            name: "ask_agent",
            response: { status: "completed", result: { display: "ok" } },
          },
        ],
      },
    });
  });
});
