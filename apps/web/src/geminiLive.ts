import {
  BrowserGeminiAudio,
  GEMINI_INPUT_MIME_TYPE,
  GEMINI_OUTPUT_SAMPLE_RATE,
  type GeminiLiveAudio,
  type PcmChunk,
} from "./audio";
import {
  createHvcDiagnosticsEvent,
  type HvcDiagnosticsDetail,
  type HvcDiagnosticsEventName,
} from "./diagnostics";
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

function buildDefaultGenerationConfig(voiceName: string): Record<string, unknown> {
  return {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName },
      },
    },
  };
}

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
  private hasFirstProviderResponse = false;
  private hasFirstAudioPlayback = false;
  private sessionClosed = false;
  private clientInitiatedClose = false;
  private toolCallSequence = 0;
  private suppressedResponseTurns = 0;
  private readonly canceledToolCallIds = new Set<string>();
  private readonly toolAbortControllers = new Map<string, AbortController>();
  private readonly toolCallSequences = new Map<string, number>();
  private readonly pendingToolCalls = new Map<string, GeminiFunctionCall>();
  private readonly activeToolCalls = new Map<string, GeminiFunctionCall>();

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
    this.clientInitiatedClose = false;
    const token = await this.tokenProvider();
    this.callbacks.onToken?.({
      expires_at: token.expires_at,
      mode: token.mode,
      model: token.model,
      voice_name: token.voice_name ?? token.voiceName,
    });

    const setupModel = token.model ?? this.sessionOptions.model ?? this.options.model;
    const setupVoiceName =
      token.voice_name ??
      token.voiceName ??
      this.sessionOptions.voiceName ??
      "Charon";
    const socket = this.webSocketFactory(buildGeminiLiveUrl(token.token));
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => {
      this.sendJson(this.buildSetupMessage(setupModel, setupVoiceName));
      this.emitStatus("connected");
    };
    socket.onmessage = (event) => void this.handleMessage(event);
    socket.onerror = () =>
      this.emitError(new Error("Gemini Live websocket error"));
    socket.onclose = (event) => {
      this.audio?.close();
      const reason = this.clientInitiatedClose
        ? "client_disconnect"
        : "provider_close";
      this.clientInitiatedClose = false;
      this.emitSessionClose({
        reason,
        closeCode: event.code,
        closeReason: event.reason,
      });
      this.emitStatus("closed");
      this.callbacks.onClose?.(event);
    };
  }

  interrupt(): void {
    this.audio?.interrupt();
    this.emitStatus("interrupted");
  }

  abandonPendingResponse(): void {
    this.suppressedResponseTurns += 1;
    this.cancelActiveToolCalls({ respondToProvider: true });
    this.audio?.interrupt();
  }

  finalizeInputTurn(): boolean {
    const hadOpenAudioStream = this.audioStreamOpen;
    this.captureEnabled = false;
    this.applyCaptureGate();
    this.endAudioStream();
    return hadOpenAudioStream;
  }

  setHoldToTalk(active: boolean): void {
    this.holdToTalkActive = active;
    this.applyCaptureGate();
  }

  setMicrophoneEnabled(enabled: boolean): void {
    this.captureEnabled = enabled;
    this.applyCaptureGate();
  }

  resume(): void {
    this.hasFirstProviderResponse = false;
    this.emitDiagnostics("session_resume");
  }

  disconnect(): void {
    this.cancelActiveToolCalls();
    this.endAudioStream();
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      this.clientInitiatedClose = true;
      socket.close(1000, "client disconnect");
    } else {
      this.emitSessionClose({ reason: "client_disconnect" });
    }
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

  private buildSetupMessage(
    model: string,
    voiceName: string,
  ): Record<string, unknown> {
    const setup: Record<string, unknown> = {
      model: toGeminiModelResource(model),
      generationConfig:
        this.sessionOptions.generationConfig ??
        buildDefaultGenerationConfig(voiceName),
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
    this.recordFirstProviderResponse(message);

    if (message.setupComplete || message.setup_complete) {
      this.emitStatus("setup-complete");
      if (this.sessionOptions.audio?.startCapture !== false)
        await this.startCapture();
    }

    const toolCall = message.toolCall ?? message.tool_call;
    const functionCalls = isRecord(toolCall)
      ? (toolCall.functionCalls ?? toolCall.function_calls)
      : undefined;
    const hasFunctionCalls = Array.isArray(functionCalls) && functionCalls.length > 0;

    const serverContent = message.serverContent ?? message.server_content;
    const suppressResponse = this.suppressedResponseTurns > 0;
    let completedSuppressedResponse = false;
    if (isRecord(serverContent)) {
      completedSuppressedResponse = await this.handleServerContent(serverContent, {
        suppressTurnComplete: hasFunctionCalls,
        suppressResponse,
      });
    }

    const cancellation =
      message.toolCallCancellation ?? message.tool_call_cancellation;
    this.recordToolCallCancellations(cancellation);

    if (hasFunctionCalls) {
      if (suppressResponse) {
        if (!completedSuppressedResponse) {
          this.sendSuppressedToolResponses(
            functionCalls as Array<Record<string, unknown>>,
          );
        }
        return;
      }
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
      this.emitToolCancellation(requestIds, "provider");
      void this.toolCanceler(requestIds).catch((error) => this.emitError(error));
    }
  }

  private cancelActiveToolCalls({
    respondToProvider = false,
  }: { respondToProvider?: boolean } = {}): void {
    const requestIds = Array.from(
      new Set([
        ...this.toolAbortControllers.keys(),
        ...this.pendingToolCalls.keys(),
      ]),
    );
    if (requestIds.length === 0) return;
    const activeCalls = requestIds.flatMap((id) => {
      const call = this.pendingToolCalls.get(id) ?? this.activeToolCalls.get(id);
      return call ? [call] : [];
    });
    for (const id of requestIds) {
      this.canceledToolCallIds.add(id);
      this.pendingToolCalls.delete(id);
      this.toolAbortControllers.get(id)?.abort();
    }
    if (respondToProvider) this.sendAbandonedToolResponses(activeCalls);
    this.emitToolCancellation(requestIds, "client_disconnect");
    void this.toolCanceler(requestIds).catch((error) => this.emitError(error));
  }

  private async handleServerContent(
    serverContent: Record<string, unknown>,
    options: { suppressTurnComplete?: boolean; suppressResponse?: boolean } = {},
  ): Promise<boolean> {
    const turnComplete = Boolean(
      serverContent.turnComplete || serverContent.turn_complete,
    );
    if (options.suppressResponse && this.suppressedResponseTurns > 0) {
      if (serverContent.interrupted) this.audio?.interrupt();
      if (turnComplete && !options.suppressTurnComplete) {
        this.finishSuppressedResponseTurn();
        return true;
      }
      return false;
    }

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
        if (this.audio && !this.hasFirstAudioPlayback) {
          this.hasFirstAudioPlayback = true;
          this.emitDiagnostics("audio_playback_first", {
            sourceSampleRate: GEMINI_OUTPUT_SAMPLE_RATE,
          });
        }
      }
      if (typeof part.text === "string" && part.text.trim()) {
        this.callbacks.onTranscript?.({
          role: "model",
          text: part.text,
          final: false,
        });
      }
    }

    if (turnComplete && !options.suppressTurnComplete) {
      this.emitStatus("turn-complete");
      return true;
    }
    return false;
  }

  private finishSuppressedResponseTurn(): void {
    if (this.suppressedResponseTurns > 0) this.suppressedResponseTurns -= 1;
    this.emitStatus("turn-complete");
  }

  private sendSuppressedToolResponses(calls: Array<Record<string, unknown>>): void {
    const normalizedCalls = calls.flatMap((rawCall) => {
      const call = normalizeFunctionCall(rawCall);
      return call ? [call] : [];
    });
    this.sendAbandonedToolResponses(normalizedCalls);
  }

  private sendAbandonedToolResponses(calls: GeminiFunctionCall[]): void {
    const functionResponses = calls.map((call) => ({
      id: call.id,
      name: call.name,
      response: { status: "cancelled", reason: "abandoned_response" },
    }));
    if (functionResponses.length === 0) return;
    this.sendJson({ toolResponse: { functionResponses } });
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
    const pendingCalls = calls.flatMap((rawCall) => {
      const call = normalizeFunctionCall(rawCall);
      if (!call || this.canceledToolCallIds.has(call.id)) return [];
      const toolCallSeq = this.sequenceToolCall(call.id);
      this.pendingToolCalls.set(call.id, call);
      this.emitDiagnostics("tool_call_request", {
        toolCallSeq,
        toolName: call.name,
      });
      return [{ call, toolCallSeq, toolName: call.name }];
    });
    const responseMetrics: Array<{
      response: GeminiFunctionResponse;
      toolCallSeq: number;
      toolName: string;
    }> = [];

    for (const { call, toolCallSeq, toolName } of pendingCalls) {
      if (this.canceledToolCallIds.delete(call.id)) {
        this.pendingToolCalls.delete(call.id);
        this.toolCallSequences.delete(call.id);
        continue;
      }
      this.callbacks.onToolCall?.(call);
      const controller = new AbortController();
      this.pendingToolCalls.delete(call.id);
      this.toolAbortControllers.set(call.id, controller);
      this.activeToolCalls.set(call.id, call);
      let response: Record<string, unknown> | null = null;
      let authError: Error | null = null;
      try {
        response = asResponseObject(
          await this.toolCaller(call, { signal: controller.signal }),
        );
      } catch (error) {
        if (isAuthenticationError(error)) {
          authError =
            error instanceof Error ? error : new Error("Authentication required");
        } else {
          response = {
            error: error instanceof Error ? error.message : "Tool call failed",
          };
        }
      } finally {
        this.toolAbortControllers.delete(call.id);
        this.activeToolCalls.delete(call.id);
      }

      if (authError) {
        this.toolCallSequences.delete(call.id);
        this.emitError(authError);
        return;
      }

      if (this.canceledToolCallIds.delete(call.id)) {
        this.toolCallSequences.delete(call.id);
        continue;
      }

      const functionResponse = { id: call.id, name: call.name, response: response ?? {} };
      responseMetrics.push({
        response: functionResponse,
        toolCallSeq,
        toolName,
      });
    }

    const activeResponses = responseMetrics.filter(({ response }) => {
      if (this.canceledToolCallIds.delete(response.id)) {
        this.toolCallSequences.delete(response.id);
        return false;
      }
      return true;
    });
    for (const { response, toolCallSeq, toolName } of activeResponses) {
      this.emitDiagnostics("tool_call_response", {
        toolCallSeq,
        toolName,
      });
      this.callbacks.onToolResponse?.(response);
      this.toolCallSequences.delete(response.id);
    }
    if (activeResponses.length > 0) {
      this.sendJson({
        toolResponse: {
          functionResponses: activeResponses.map(({ response }) => response),
        },
      });
    }
  }

  private async startCapture(): Promise<void> {
    if (!this.audio || this.captureStarted) return;
    this.captureStarted = true;
    this.applyCaptureGate();
    await this.audio.startCapture((chunk) => this.sendAudioChunk(chunk));
    this.emitDiagnostics("mic_start");
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
    this.emitDiagnostics("session_error", { message: error.message });
    this.emitStatus("error");
    this.callbacks.onError?.(error);
  }

  private emitDiagnostics(
    name: HvcDiagnosticsEventName,
    detail?: HvcDiagnosticsDetail,
  ): void {
    this.callbacks.onDiagnosticsEvent?.(
      createHvcDiagnosticsEvent(name, detail),
    );
  }

  private emitSessionClose(detail: HvcDiagnosticsDetail): void {
    if (this.sessionClosed) return;
    this.sessionClosed = true;
    this.emitDiagnostics("session_close", detail);
  }

  private recordFirstProviderResponse(
    message: Record<string, unknown>,
  ): void {
    if (this.hasFirstProviderResponse) return;
    this.hasFirstProviderResponse = true;
    this.emitDiagnostics("provider_response_first", {
      providerEventType: providerEventType(message),
    });
  }

  private sequenceToolCall(id: string): number {
    const existing = this.toolCallSequences.get(id);
    if (existing !== undefined) return existing;
    this.toolCallSequence += 1;
    this.toolCallSequences.set(id, this.toolCallSequence);
    return this.toolCallSequence;
  }

  private emitToolCancellation(requestIds: string[], reason: string): void {
    const toolCallSeqs = requestIds
      .map((id) => this.toolCallSequences.get(id))
      .filter((seq): seq is number => seq !== undefined);
    this.emitDiagnostics("tool_call_cancellation", {
      reason,
      count: requestIds.length,
      ...(toolCallSeqs.length === 1
        ? { toolCallSeq: toolCallSeqs[0] }
        : {}),
      ...(toolCallSeqs.length > 1 ? { toolCallSeqs } : {}),
    });
    for (const id of requestIds) this.toolCallSequences.delete(id);
  }
}

function providerEventType(message: Record<string, unknown>): string {
  if (message.setupComplete || message.setup_complete) return "setupComplete";
  if (message.serverContent || message.server_content) return "serverContent";
  if (message.toolCall || message.tool_call) return "toolCall";
  if (message.toolCallCancellation || message.tool_call_cancellation)
    return "toolCallCancellation";
  return "message";
}

function isAuthenticationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /401|Authentication required|PIN required|Session expired/i.test(
    error.message,
  );
}

export { GEMINI_INPUT_MIME_TYPE };
