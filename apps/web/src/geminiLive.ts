import {
  BrowserGeminiAudio,
  GEMINI_INPUT_MIME_TYPE,
  GEMINI_OUTPUT_SAMPLE_RATE,
  type GeminiLiveAudio,
  type PcmChunk,
} from "./audio";
import {
  defaultTokenProvider,
  defaultToolCaller,
  defaultToolCanceler,
  defaultTools,
} from "./gemini-live/defaults";
import {
  buildGeminiLiveUrl,
  isRecord,
  parseServerMessage,
  SOCKET_OPEN,
  toGeminiModelResource,
} from "./gemini-live/protocol";
import {
  asResponseObject,
  normalizeFunctionCall,
} from "./gemini-live/toolCalls";
import type {
  GeminiEphemeralToken,
  GeminiFunctionCall,
  GeminiFunctionResponse,
  GeminiLiveCallbacks,
  GeminiLiveDependencies,
  GeminiLiveSessionOptions,
  GeminiLiveStatus,
  GeminiToolCallContext,
  LiveWebSocket,
} from "./gemini-live/types";

export type {
  GeminiEphemeralToken,
  GeminiFunctionCall,
  GeminiFunctionResponse,
  GeminiLiveAudioConfig,
  GeminiLiveCallbacks,
  GeminiLiveDependencies,
  GeminiLiveSessionOptions,
  GeminiLiveStatus,
  GeminiToolDeclaration,
  GeminiTranscriptEvent,
} from "./gemini-live/types";
export { buildGeminiLiveUrl } from "./gemini-live/protocol";

export class GeminiLiveSession {
  private readonly options: Required<Pick<GeminiLiveSessionOptions, "model">>;
  private readonly sessionOptions: GeminiLiveSessionOptions;
  private readonly callbacks: GeminiLiveCallbacks;
  private readonly tokenProvider: () => Promise<GeminiEphemeralToken>;
  private readonly toolCaller: (
    call: GeminiFunctionCall,
    context: GeminiToolCallContext,
  ) => Promise<unknown>;
  private readonly toolCanceler: (requestIds: string[]) => Promise<unknown>;
  private readonly webSocketFactory: (url: string) => LiveWebSocket;
  private readonly audio?: GeminiLiveAudio;
  private socket?: LiveWebSocket;
  private captureStarted = false;
  private holdToTalkActive = false;
  private captureEnabled = true;
  private audioStreamOpen = false;
  private audioGateOpen = false;
  private readonly canceledToolCallIds = new Set<string>();
  private readonly toolAbortControllers = new Map<string, AbortController>();

  constructor(
    options: GeminiLiveSessionOptions = {},
    dependencies: GeminiLiveDependencies = {},
  ) {
    this.options = {
      model: options.model ?? "gemini-2.5-flash-native-audio-latest",
    };
    this.sessionOptions = options;
    this.callbacks = options.callbacks ?? {};
    this.tokenProvider = dependencies.tokenProvider ?? defaultTokenProvider;
    this.toolCaller = dependencies.toolCaller ?? defaultToolCaller;
    this.toolCanceler = dependencies.toolCanceler ?? defaultToolCanceler;
    this.webSocketFactory =
      dependencies.webSocketFactory ??
      ((url: string) => new WebSocket(url) as unknown as LiveWebSocket);
    this.audio = dependencies.audio ?? new BrowserGeminiAudio();
    this.captureEnabled = !options.audio?.startMuted;
  }

  async connect(): Promise<void> {
    this.emitStatus("connecting");
    const token = await this.tokenProvider();
    this.callbacks.onToken?.({
      expires_at: token.expires_at,
      mode: token.mode,
    });

    const socket = this.webSocketFactory(buildGeminiLiveUrl(token.token));
    this.socket = socket;
    socket.onopen = () => {
      this.sendJson(this.buildSetupMessage());
      this.emitStatus("connected");
    };
    socket.onmessage = (event) => void this.handleMessage(event);
    socket.onerror = () =>
      this.emitError(new Error("Gemini Live websocket error"));
    socket.onclose = (event) => {
      this.audio?.close();
      this.emitStatus("closed");
      this.callbacks.onClose?.(event);
    };
  }

  interrupt(): void {
    this.audio?.interrupt();
    this.emitStatus("interrupted");
  }

  setHoldToTalk(active: boolean): void {
    this.holdToTalkActive = active;
    this.applyCaptureGate();
  }

  setMicrophoneEnabled(enabled: boolean): void {
    this.captureEnabled = enabled;
    this.applyCaptureGate();
  }

  disconnect(): void {
    this.cancelActiveToolCalls();
    this.endAudioStream();
    this.socket?.close(1000, "client disconnect");
    this.socket = undefined;
    this.audio?.close();
  }

  sendAudioChunk(chunk: PcmChunk): void {
    if (!this.shouldSendAudio()) return;
    this.audioStreamOpen = true;
    this.sendJson({
      realtimeInput: {
        mediaChunks: [{ mimeType: chunk.mimeType, data: chunk.data }],
      },
    });
  }

  private buildSetupMessage(): Record<string, unknown> {
    const setup: Record<string, unknown> = {
      model: toGeminiModelResource(this.options.model),
      generationConfig: this.sessionOptions.generationConfig ?? {
        responseModalities: ["AUDIO"],
      },
      tools: this.sessionOptions.tools ?? defaultTools(),
    };

    if (this.sessionOptions.systemInstruction) {
      setup.systemInstruction = {
        parts: [{ text: this.sessionOptions.systemInstruction }],
      };
    }
    if (this.sessionOptions.enableInputTranscription !== false)
      setup.inputAudioTranscription = {};
    if (this.sessionOptions.enableOutputTranscription !== false)
      setup.outputAudioTranscription = {};

    return { setup };
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    const message = parseServerMessage(event.data);
    if (!message) return;

    if (message.setupComplete || message.setup_complete) {
      this.emitStatus("setup-complete");
      if (this.sessionOptions.audio?.startCapture !== false)
        await this.startCapture();
    }

    const serverContent = message.serverContent ?? message.server_content;
    if (isRecord(serverContent)) await this.handleServerContent(serverContent);

    const cancellation =
      message.toolCallCancellation ?? message.tool_call_cancellation;
    this.recordToolCallCancellations(cancellation);

    const toolCall = message.toolCall ?? message.tool_call;
    const functionCalls = isRecord(toolCall)
      ? (toolCall.functionCalls ?? toolCall.function_calls)
      : undefined;
    if (Array.isArray(functionCalls) && functionCalls.length > 0) {
      await this.handleToolCalls(
        functionCalls as Array<Record<string, unknown>>,
      );
    }
  }

  private recordToolCallCancellations(value: unknown): void {
    if (!isRecord(value)) return;
    const ids = value.ids ?? value.functionIds ?? value.function_ids;
    if (!Array.isArray(ids)) return;
    const requestIds: string[] = [];
    for (const id of ids) {
      if (typeof id !== "string" || id.length === 0) continue;
      this.canceledToolCallIds.add(id);
      requestIds.push(id);
      this.toolAbortControllers.get(id)?.abort();
    }
    if (requestIds.length > 0) {
      void this.toolCanceler(requestIds).catch((error) => this.emitError(error));
    }
  }

  private cancelActiveToolCalls(): void {
    const requestIds = Array.from(this.toolAbortControllers.keys());
    if (requestIds.length === 0) return;
    for (const id of requestIds) {
      this.canceledToolCallIds.add(id);
      this.toolAbortControllers.get(id)?.abort();
    }
    void this.toolCanceler(requestIds).catch((error) => this.emitError(error));
  }

  private async handleServerContent(
    serverContent: Record<string, unknown>,
  ): Promise<void> {
    if (serverContent.interrupted) {
      this.interrupt();
    }

    this.emitTranscription(serverContent.inputTranscription, "user");
    this.emitTranscription(serverContent.input_transcription, "user");
    this.emitTranscription(serverContent.outputTranscription, "model");
    this.emitTranscription(serverContent.output_transcription, "model");

    const modelTurn = (serverContent.modelTurn ?? serverContent.model_turn) as
      | { parts?: Array<Record<string, unknown>> }
      | undefined;
    for (const part of modelTurn?.parts ?? []) {
      const inlineData = (part.inlineData ?? part.inline_data) as
        | { mimeType?: string; mime_type?: string; data?: string }
        | undefined;
      const mimeType = inlineData?.mimeType ?? inlineData?.mime_type ?? "";
      if (inlineData?.data && mimeType.startsWith("audio/pcm")) {
        this.emitStatus("model-speaking");
        await this.audio?.playPcm16Base64(
          inlineData.data,
          GEMINI_OUTPUT_SAMPLE_RATE,
        );
      }
      if (typeof part.text === "string" && part.text.trim()) {
        this.callbacks.onTranscript?.({
          role: "model",
          text: part.text,
          final: false,
        });
      }
    }

    if (serverContent.turnComplete || serverContent.turn_complete) {
      this.emitStatus("listening");
    }
  }

  private emitTranscription(value: unknown, role: "user" | "model"): void {
    if (!value || typeof value !== "object") return;
    const transcript = value as {
      text?: unknown;
      finished?: unknown;
      final?: unknown;
    };
    if (typeof transcript.text !== "string" || transcript.text.length === 0)
      return;
    this.callbacks.onTranscript?.({
      role,
      text: transcript.text,
      final: Boolean(transcript.finished ?? transcript.final),
    });
  }

  private async handleToolCalls(
    calls: Array<Record<string, unknown>>,
  ): Promise<void> {
    const functionResponses: GeminiFunctionResponse[] = [];

    for (const rawCall of calls) {
      const call = normalizeFunctionCall(rawCall);
      if (!call) continue;
      if (this.canceledToolCallIds.has(call.id)) continue;
      this.callbacks.onToolCall?.(call);

      const controller = new AbortController();
      this.toolAbortControllers.set(call.id, controller);
      let response: Record<string, unknown>;
      try {
        response = asResponseObject(
          await this.toolCaller(call, { signal: controller.signal }),
        );
      } catch (error) {
        response = {
          error: error instanceof Error ? error.message : "Tool call failed",
        };
      } finally {
        this.toolAbortControllers.delete(call.id);
      }

      if (this.canceledToolCallIds.delete(call.id)) continue;

      const functionResponse = { id: call.id, name: call.name, response };
      functionResponses.push(functionResponse);
    }

    const activeResponses = functionResponses.filter((response) => {
      if (this.canceledToolCallIds.delete(response.id)) return false;
      return true;
    });
    for (const response of activeResponses) {
      this.callbacks.onToolResponse?.(response);
    }
    if (activeResponses.length > 0) {
      this.sendJson({ toolResponse: { functionResponses: activeResponses } });
    }
  }

  private async startCapture(): Promise<void> {
    if (!this.audio || this.captureStarted) return;
    this.captureStarted = true;
    this.applyCaptureGate();
    await this.audio.startCapture((chunk) => this.sendAudioChunk(chunk));
    this.emitStatus("listening");
  }

  private applyCaptureGate(): void {
    const holdGate = this.sessionOptions.audio?.holdToTalkOnly
      ? this.holdToTalkActive
      : true;
    const nextOpen = this.captureEnabled && holdGate;
    this.audio?.setCaptureEnabled(nextOpen);
    if (this.audioGateOpen && !nextOpen) this.endAudioStream();
    this.audioGateOpen = nextOpen;
  }

  private shouldSendAudio(): boolean {
    const holdGate = this.sessionOptions.audio?.holdToTalkOnly
      ? this.holdToTalkActive
      : true;
    return this.captureEnabled && holdGate;
  }

  private endAudioStream(): void {
    if (!this.audioStreamOpen) return;
    this.sendJson({ realtimeInput: { audioStreamEnd: true } });
    this.audioStreamOpen = false;
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (this.socket?.readyState !== SOCKET_OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  private emitStatus(status: GeminiLiveStatus): void {
    this.callbacks.onStatus?.(status);
  }

  private emitError(error: Error): void {
    this.emitStatus("error");
    this.callbacks.onError?.(error);
  }
}

export { GEMINI_INPUT_MIME_TYPE };
