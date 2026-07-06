import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from "react";
import {
  Hand,
  KeyRound,
  LoaderCircle,
  Mic,
  MicOff,
  Radio,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  ApiError,
  ApiRequestTimeoutError,
  SPEECH_TRANSCRIPTION_TIMEOUT_MS,
  cancelTextJob,
  getReadyz,
  getSession,
  getTextJob,
  login,
  sendText,
  transcribeSpeechAudio,
} from "./api";
import { BrowserGeminiAudio } from "./audio";
import {
  createDefaultRealtimeVoiceSession,
  type RealtimeTranscriptEvent,
  type RealtimeVoiceCallbacks,
  type RealtimeVoiceSession,
} from "./realtime";
import { initialVoiceState, voiceReducer } from "./stateMachine";
import type {
  ChatJobStatus,
  ReadyzResponse,
  TextChatResponse,
  TextChatResult,
  TranscriptEntry,
  VoiceMode,
} from "./types";
import { VoiceOrb } from "./components/VoiceOrb";
import { TranscriptDrawer } from "./components/TranscriptDrawer";
import {
  readPendingTextJobs,
  removePendingTextJob,
  savePendingTextJob,
} from "./chatJobStorage";
import {
  readSpokenCompletionNotificationsEnabled,
  saveSpokenCompletionNotificationsEnabled,
} from "./completionNotificationPreference";
import { agentName, agentNounLower } from "./config";
import {
  createHvcDiagnosticsRecorder,
  exposeHvcDiagnostics,
  type HvcDiagnosticsRecorder,
} from "./diagnostics";
import {
  browserSupportsSpeechRecognition,
  createSpeechRecognition,
  readSpeechRecognitionTranscript,
  type BrowserSpeechRecognition,
} from "./speechRecognition";
import "./styles.css";

const uid = () => Math.random().toString(36).slice(2);
const HOLD_DELAY_MS = 220;
const NO_SPEECH_TIMEOUT_MS = 3500;
const BASIC_HOLD_SPEECH_RESTART_LIMIT = 2;
const BASIC_HOLD_RELEASE_WATCHDOG_MS = 2000;
const INITIAL_RESPONSE_TIMEOUT_MS = 14000;
const TOOL_RESPONSE_TIMEOUT_MS = 95000;
const TEXT_JOB_POLL_MS = 1400;
const SPOKEN_COMPLETION_NOTICE_TEXT = "Done. Background reply is ready.";
const SPOKEN_COMPLETION_RESTORE_DELAY_MS = 2500;
const SPOKEN_COMPLETION_RESTORE_CHECK_MS = 250;
const SPOKEN_COMPLETION_MAX_DURATION_MS = 10000;
const BASIC_HOLD_STT_AUDIO_BYTE_LIMIT = 1_920_000;
const BASIC_HOLD_STT_SAMPLE_BYTES_PER_SECOND = 16_000 * 2;
const BASIC_HOLD_STT_TIMEOUT_PER_SECOND_MS = 150;
const BASIC_HOLD_STT_TIMEOUT_MAX_MS = 12_000;
const SESSION_EXPIRED_MESSAGE = "Session expired. Enter your private PIN again.";
const READYZ_REFRESH_MS = 45_000;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const;
const RECONNECT_GIVE_UP_MS = 45_000;
const TOKEN_RECONNECT_LEEWAY_MS = 5_000;
const TOKEN_RECONNECT_DEFER_MS = 1_000;
const FINALIZING_NUDGE_MS = 620;
const MAX_BROWSER_TIMER_MS = 2_147_483_647;

function buildLiveHermesSystemInstruction(currentAgentName: string): string {
  return [
    `You are the realtime voice transport for ${currentAgentName}.`,
    "For requests needing an answer, call ask_agent with the user's latest words before responding.",
    "Include recent transcript context when useful.",
    `Do not answer from your own model knowledge as ${currentAgentName}.`,
    "After ask_agent returns, speak its answer naturally without mentioning tools.",
    "If permission or external action may be needed, call ask_agent so the Hermes agent can explain next steps.",
  ].join(" ");
}

type PressState = {
  pointerId: number | null;
  timer: number | null;
  holding: boolean;
  activated: boolean;
  released: boolean;
};

type AuthState = "checking" | "authenticated" | "needs-pin";

type AgentConnectionState = "checking" | "connected" | "degraded" | "unavailable";

type AgentConnection = {
  state: AgentConnectionState;
  label: string;
  detail: string;
};

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
  removeEventListener?: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

type VoiceTurn = {
  id: number;
  heardUser: boolean;
  heardAgent: boolean;
  usedTool: boolean;
  expectsProviderTurnComplete: boolean;
  waiting: boolean;
};

type TextFocusReturnMode = "none" | "restore-capture" | "paused" | "muted";

type TextJobEntryMeta = {
  entryId: string;
  restored: boolean;
};

type SpeechCaptureState = {
  recognition: BrowserSpeechRecognition;
  audio: BrowserGeminiAudio | null;
  audioChunksBase64: string[];
  audioBytes: number;
  audioCapped: boolean;
  audioCapNotified: boolean;
  entryId: string | null;
  finalText: string;
  interimText: string;
  ended: boolean;
  finished: boolean;
  releaseRequested: boolean;
  restartAttempts: number;
  releaseWatchdogTimer: number | null;
  stopping: boolean;
  aborting: boolean;
};

type AuthGateProps = {
  status: AuthState;
  agentName: string;
  pin: string;
  error: string;
  submitting: boolean;
  onPinChange: (pin: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

const emptyPress = (): PressState => ({
  pointerId: null,
  timer: null,
  holding: false,
  activated: false,
  released: true,
});

const checkingAgentConnection: AgentConnection = {
  state: "checking",
  label: "Checking",
  detail: "Verifying connection",
};

function agentConnectionFromReadyz(readyz: ReadyzResponse): AgentConnection {
  const hermes = readyz.checks?.hermes;
  if (readyz.ok && hermes?.available !== false) {
    return {
      state: "connected",
      label: "Ready",
      detail: "Agent reachable",
    };
  }
  if (readyz.ok) {
    return {
      state: "degraded",
      label: "Limited",
      detail: "Agent unavailable",
    };
  }
  return {
    state: "unavailable",
    label: "Backend unreachable",
    detail: "Check the private connection",
  };
}

function isAuthFailure(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 401;
  if (error instanceof Error)
    return /401|Authentication required|PIN required|Session expired/i.test(
      error.message,
    );
  return false;
}

function AuthGate({
  status,
  agentName,
  pin,
  error,
  submitting,
  onPinChange,
  onSubmit,
}: AuthGateProps) {
  const checking = status === "checking";

  return (
    <div
      className="auth-gate"
      role="dialog"
      aria-modal="true"
      aria-label={checking ? "Checking private session" : `Unlock ${agentName}`}
    >
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-icon" aria-hidden="true">
          {checking ? (
            <LoaderCircle className="spin" size={22} />
          ) : (
            <KeyRound size={22} />
          )}
        </div>
        <h2>{checking ? "Checking private session" : "Unlock private session"}</h2>
        {!checking ? (
          <>
            <label htmlFor="hvc-pin">Private PIN</label>
            <input
              id="hvc-pin"
              type="password"
              value={pin}
              autoComplete="current-password"
              autoFocus
              disabled={submitting}
              onChange={(event) => onPinChange(event.currentTarget.value)}
            />
            <button type="submit" disabled={submitting || !pin.trim()}>
              {submitting ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <KeyRound size={16} />
              )}
              {submitting ? "Unlocking" : "Unlock"}
            </button>
          </>
        ) : null}
        {error && !checking ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}

export default function App() {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("push-to-talk");
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [agentConnection, setAgentConnection] = useState<AgentConnection>(
    checkingAgentConnection,
  );
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [cancellingTextJobs, setCancellingTextJobs] = useState<Set<string>>(
    () => new Set(),
  );
  const [
    spokenCompletionNotificationsEnabled,
    setSpokenCompletionNotificationsEnabled,
  ] = useState(readSpokenCompletionNotificationsEnabled);
  const [finalizingNudge, setFinalizingNudge] = useState(false);
  const stateRef = useRef(state);
  const authStateRef = useRef(authState);
  const voiceModeRef = useRef(voiceMode);
  const entriesRef = useRef(entries);
  const sessionRef = useRef<RealtimeVoiceSession | null>(null);
  const speechCaptureRef = useRef<SpeechCaptureState | null>(null);
  const speechFinalizingRef = useRef(false);
  const basicHoldMicPermissionPrimedRef = useRef(false);
  const basicHoldMicPermissionPendingRef = useRef<Promise<boolean> | null>(null);
  const speechRecognitionDisclosureShownRef = useRef(false);
  const sttProviderRef = useRef("gemini");
  const diagnosticsRef = useRef<HvcDiagnosticsRecorder | null>(null);
  const sessionGenerationRef = useRef(0);
  const connectingRef = useRef(false);
  const endingRef = useRef(false);
  const liveDesiredRef = useRef(false);
  const reconnectingRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectStartedAtRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const tokenReconnectTimerRef = useRef<number | null>(null);
  const sessionLossHandledGenerationRef = useRef(0);
  const readyzRefreshIntervalRef = useRef<number | null>(null);
  const readyzRequestRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wakeLockReleaseHandlerRef = useRef<(() => void) | null>(null);
  const wakeLockRequestingRef = useRef(false);
  const finalizingNudgeTimerRef = useRef<number | null>(null);
  const transcriptDraftsRef = useRef<
    Partial<Record<RealtimeTranscriptEvent["role"], string>>
  >({});
  const voiceTurnRef = useRef<VoiceTurn>({
    id: 0,
    heardUser: false,
    heardAgent: false,
    usedTool: false,
    expectsProviderTurnComplete: false,
    waiting: false,
  });
  const toolCallsInFlightRef = useRef(new Set<string>());
  const staleProviderTurnCompletesRef = useRef(0);
  const captureReadyRef = useRef(false);
  const pendingHoldActivationRef = useRef<(() => boolean) | null>(null);
  const noSpeechTimerRef = useRef<number | null>(null);
  const responseTimerRef = useRef<number | null>(null);
  const heardUserDuringHoldRef = useRef(false);
  const textFocusReturnModeRef = useRef<TextFocusReturnMode>("none");
  const textFocusEpochRef = useRef(0);
  const textComposerFocusedRef = useRef(false);
  const textJobEntriesRef = useRef(new Map<string, TextJobEntryMeta>());
  const textJobPollTimersRef = useRef(new Map<string, number>());
  const handsFreeTurnPendingRef = useRef(false);
  const spokenCompletionNoticeActiveRef = useRef(false);
  const ignoreStalledCompletionSpeechRef = useRef(false);
  const spokenCompletionNotificationsEnabledRef = useRef(
    spokenCompletionNotificationsEnabled,
  );
  const initialPressState = useMemo(emptyPress, []);
  const pressRef = useRef<PressState>(initialPressState);

  if (diagnosticsRef.current === null) {
    diagnosticsRef.current = createHvcDiagnosticsRecorder();
  }

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    spokenCompletionNotificationsEnabledRef.current =
      spokenCompletionNotificationsEnabled;
  }, [spokenCompletionNotificationsEnabled]);

  useEffect(() => {
    exposeHvcDiagnostics(diagnosticsRef.current);
    const cancel = () => cancelPress();
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        cancelPress();
        return;
      }
      handleVisibleReturn();
    };
    const pageshow = () => handleVisibleReturn();
    window.addEventListener("blur", cancel);
    window.addEventListener("pageshow", pageshow);
    document.addEventListener("visibilitychange", visibility);
    const currentEndingRef = endingRef;
    const currentSessionRef = sessionRef;
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pageshow", pageshow);
      document.removeEventListener("visibilitychange", visibility);
      clearPressTimer();
      clearVoiceTurnTimers();
      clearTextJobPollTimers();
      clearReconnectTimer();
      clearTokenReconnectTimer();
      clearReadyzRefreshInterval();
      clearFinalizingNudgeTimer();
      void releaseWakeLock();
      const activeSpeechCapture = speechCaptureRef.current;
      if (activeSpeechCapture) {
        activeSpeechCapture.finished = true;
        activeSpeechCapture.aborting = true;
        clearSpeechCapture(activeSpeechCapture);
        try {
          activeSpeechCapture.recognition.abort();
        } catch {
          // The browser may already have ended recognition during teardown.
        }
      }
      speechCaptureRef.current = null;
      currentEndingRef.current = true;
      currentSessionRef.current?.disconnect();
      currentSessionRef.current = null;
      exposeHvcDiagnostics(null);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    getSession()
      .then((session) => {
        if (cancelled) return;
        setAuthState(session.authenticated ? "authenticated" : "needs-pin");
        setAuthError("");
      })
      .catch(() => {
        if (cancelled) return;
        setAuthState("needs-pin");
        setAuthError("Could not verify the private session.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authStateRef.current !== "authenticated") return;
    recoverPendingTextJobs();
  }, [authState]);

  useEffect(() => {
    if (authState !== "authenticated") {
      clearReadyzRefreshInterval();
      setAgentConnection(checkingAgentConnection);
      return;
    }
    const online = () => void refreshAgentConnection();
    const offline = () =>
      setAgentConnection({
        state: "unavailable",
        label: "Offline",
        detail: "Browser network is offline",
      });
    void refreshAgentConnection({ checking: true });
    readyzRefreshIntervalRef.current = window.setInterval(
      () => void refreshAgentConnection(),
      READYZ_REFRESH_MS,
    );
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      clearReadyzRefreshInterval();
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [authState]);

  useEffect(() => {
    void updateWakeLock();
  }, [authState, voiceMode, state.callState]);

  function clearReconnectTimer() {
    if (reconnectTimerRef.current === null) return;
    window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }

  function clearTokenReconnectTimer() {
    if (tokenReconnectTimerRef.current === null) return;
    window.clearTimeout(tokenReconnectTimerRef.current);
    tokenReconnectTimerRef.current = null;
  }

  function clearReadyzRefreshInterval() {
    readyzRequestRef.current += 1;
    if (readyzRefreshIntervalRef.current === null) return;
    window.clearInterval(readyzRefreshIntervalRef.current);
    readyzRefreshIntervalRef.current = null;
  }

  function clearFinalizingNudgeTimer() {
    if (finalizingNudgeTimerRef.current === null) return;
    window.clearTimeout(finalizingNudgeTimerRef.current);
    finalizingNudgeTimerRef.current = null;
  }

  async function refreshAgentConnection({
    checking = false,
  }: { checking?: boolean } = {}) {
    if (authStateRef.current !== "authenticated") return;
    const requestId = readyzRequestRef.current + 1;
    readyzRequestRef.current = requestId;
    if (checking) setAgentConnection(checkingAgentConnection);
    const readyz = await getReadyz();
    if (
      requestId !== readyzRequestRef.current ||
      authStateRef.current !== "authenticated"
    )
      return;
    const provider = readyz.checks?.stt_provider?.trim();
    if (provider) sttProviderRef.current = provider;
    setAgentConnection(agentConnectionFromReadyz(readyz));
  }

  function handleVisibleReturn() {
    void refreshAgentConnection();
    void updateWakeLock();
    if (canAutoReconnectLive()) {
      sessionRef.current?.resume();
      scheduleLiveReconnect("App returned.");
    }
  }

  function shouldHoldWakeLock(): boolean {
    if (authStateRef.current !== "authenticated") return false;
    if (stateRef.current.callState === "hold-to-talk") return true;
    return (
      voiceModeRef.current === "live" &&
      liveDesiredRef.current &&
      !["idle", "error"].includes(stateRef.current.callState)
    );
  }

  async function updateWakeLock() {
    if (!shouldHoldWakeLock()) {
      await releaseWakeLock();
      return;
    }
    await requestWakeLock();
  }

  async function requestWakeLock() {
    if (wakeLockRef.current || wakeLockRequestingRef.current) return;
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) return;
    wakeLockRequestingRef.current = true;
    try {
      const sentinel = await wakeLock.request("screen");
      if (!shouldHoldWakeLock()) {
        await sentinel.release();
        return;
      }
      wakeLockRef.current = sentinel;
      const releaseHandler = () => {
        wakeLockRef.current = null;
        wakeLockReleaseHandlerRef.current = null;
      };
      wakeLockReleaseHandlerRef.current = releaseHandler;
      sentinel.addEventListener?.("release", releaseHandler);
    } catch {
      // Wake Lock is optional and inconsistently supported on iOS.
    } finally {
      wakeLockRequestingRef.current = false;
    }
  }

  async function releaseWakeLock() {
    const sentinel = wakeLockRef.current;
    if (!sentinel) return;
    const releaseHandler = wakeLockReleaseHandlerRef.current;
    if (releaseHandler) sentinel.removeEventListener?.("release", releaseHandler);
    wakeLockRef.current = null;
    wakeLockReleaseHandlerRef.current = null;
    try {
      await sentinel.release();
    } catch {
      // The browser can release the lock before our cleanup runs.
    }
  }

  function scheduleTokenReconnect(expiresAt: string) {
    clearTokenReconnectTimer();
    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs)) return;
    const delayMs = Math.min(
      MAX_BROWSER_TIMER_MS,
      Math.max(0, expiresMs - Date.now() - TOKEN_RECONNECT_LEEWAY_MS),
    );
    tokenReconnectTimerRef.current = window.setTimeout(handleTokenReconnectDue, delayMs);
  }

  function hasActiveLiveTurn(): boolean {
    const callState = stateRef.current.callState;
    return (
      voiceTurnRef.current.waiting ||
      handsFreeTurnPendingRef.current ||
      toolCallsInFlightRef.current.size > 0 ||
      [
        "user-speaking",
        "hold-to-talk",
        "finalizing",
        "agent-thinking",
        "agent-speaking",
      ].includes(callState)
    );
  }

  function handleTokenReconnectDue() {
    tokenReconnectTimerRef.current = null;
    if (connectingRef.current || hasActiveLiveTurn()) {
      tokenReconnectTimerRef.current = window.setTimeout(
        handleTokenReconnectDue,
        TOKEN_RECONNECT_DEFER_MS,
      );
      return;
    }
    scheduleLiveReconnect("Voice token expired.");
  }

  function clearPressTimer() {
    if (pressRef.current.timer !== null) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  }

  function clearNoSpeechTimer() {
    if (noSpeechTimerRef.current !== null) {
      window.clearTimeout(noSpeechTimerRef.current);
      noSpeechTimerRef.current = null;
    }
  }

  function clearResponseTimer() {
    if (responseTimerRef.current !== null) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
  }

  function clearVoiceTurnTimers() {
    clearNoSpeechTimer();
    clearResponseTimer();
  }

  function clearHandsFreeTurnPending() {
    handsFreeTurnPendingRef.current = false;
  }

  function markHandsFreeTurnPending(event: RealtimeTranscriptEvent) {
    if (event.role !== "user") return;
    const current = stateRef.current;
    if (
      voiceTurnRef.current.waiting ||
      current.inputMode !== "hands-free" ||
      current.callState === "hold-to-talk"
    )
      return;
    handsFreeTurnPendingRef.current = true;
  }

  function isTextComposerFocused(): boolean {
    if (typeof document !== "undefined") {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement &&
        activeElement.getAttribute("aria-label") ===
          `Type a message to ${agentNounLower}`
      )
        return true;
    }
    return textComposerFocusedRef.current;
  }

  function canSpeakBackgroundCompletion(): boolean {
    if (!spokenCompletionNotificationsEnabledRef.current) return false;
    if (authState !== "authenticated") return false;
    if (!sessionRef.current || !captureReadyRef.current) return false;
    if (isTextComposerFocused()) return false;
    if (spokenCompletionNoticeActiveRef.current || isCompletionSpeechActive())
      return false;
    const current = stateRef.current;
    if (
      current.callState !== "listening" ||
      current.inputMode !== "hands-free" ||
      current.isMuted
    )
      return false;
    if (voiceTurnRef.current.waiting) return false;
    if (handsFreeTurnPendingRef.current) return false;
    if (toolCallsInFlightRef.current.size > 0) return false;
    if (pressRef.current.pointerId !== null || pressRef.current.holding)
      return false;
    if (transcriptDraftsRef.current.user || transcriptDraftsRef.current.agent)
      return false;
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      typeof window.speechSynthesis?.speak !== "function" ||
      typeof window.SpeechSynthesisUtterance !== "function"
    )
      return false;
    return true;
  }

  function isCompletionSpeechActive(): boolean {
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      !window.speechSynthesis
    )
      return false;
    try {
      return Boolean(
        window.speechSynthesis.speaking || window.speechSynthesis.pending,
      );
    } catch {
      return true;
    }
  }

  function isSpokenCompletionNoticeBlockingCapture(): boolean {
    return (
      spokenCompletionNoticeActiveRef.current ||
      (!ignoreStalledCompletionSpeechRef.current && isCompletionSpeechActive())
    );
  }

  function canEnableMicrophoneCapture(): boolean {
    return !isSpokenCompletionNoticeBlockingCapture();
  }

  function shouldRestoreMicAfterCompletionNotice(
    session: RealtimeVoiceSession,
    { ignoreSpeechActive = false }: { ignoreSpeechActive?: boolean } = {},
  ): boolean {
    const current = stateRef.current;
    return (
      authState === "authenticated" &&
      sessionRef.current === session &&
      captureReadyRef.current &&
      current.callState === "listening" &&
      current.inputMode === "hands-free" &&
      !current.isMuted &&
      !voiceTurnRef.current.waiting &&
      !handsFreeTurnPendingRef.current &&
      pressRef.current.pointerId === null &&
      !pressRef.current.holding &&
      (ignoreSpeechActive || !isCompletionSpeechActive())
    );
  }

  function shouldStopCompletionNoticeMicRestore(
    session: RealtimeVoiceSession,
  ): boolean {
    const current = stateRef.current;
    return (
      authState !== "authenticated" ||
      sessionRef.current !== session ||
      !captureReadyRef.current ||
      current.inputMode !== "hands-free" ||
      current.isMuted ||
      ["idle", "paused", "muted", "connecting", "error"].includes(
        current.callState,
      )
    );
  }

  function speakBackgroundCompletionNotice(text: string) {
    if (!canSpeakBackgroundCompletion()) return;
    const session = sessionRef.current;
    if (!session) return;

    let restored = false;
    let microphoneDisabled = false;
    let restoreTimer: number | null = null;
    let hardStopTimer: number | null = null;
    const clearRestoreTimer = () => {
      if (restoreTimer === null) return;
      window.clearTimeout(restoreTimer);
      restoreTimer = null;
    };
    const clearHardStopTimer = () => {
      if (hardStopTimer === null) return;
      window.clearTimeout(hardStopTimer);
      hardStopTimer = null;
    };
    const clearCompletionNoticeTimers = () => {
      clearRestoreTimer();
      clearHardStopTimer();
    };
    const finishCompletionNotice = () => {
      if (restored) return;
      restored = true;
      clearCompletionNoticeTimers();
      spokenCompletionNoticeActiveRef.current = false;
    };
    const completeCompletionNotice = () => {
      if (restored) return true;
      const ignoreSpeechActive = ignoreStalledCompletionSpeechRef.current;
      if (!ignoreSpeechActive && isCompletionSpeechActive()) return false;
      if (!microphoneDisabled) {
        finishCompletionNotice();
        return true;
      }
      if (
        shouldRestoreMicAfterCompletionNotice(session, {
          ignoreSpeechActive,
        })
      ) {
        session.setMicrophoneEnabled(true);
        finishCompletionNotice();
        return true;
      }
      if (shouldStopCompletionNoticeMicRestore(session)) {
        finishCompletionNotice();
        return true;
      }
      return false;
    };
    const forceStopStalledCompletionNotice = () => {
      if (restored) return;
      try {
        window.speechSynthesis?.cancel?.();
      } catch {
        // Speech engines can throw while wedged; recovery still needs to continue.
      }
      ignoreStalledCompletionSpeechRef.current = true;
      if (!completeCompletionNotice()) scheduleRestoreCheck();
    };
    const scheduleHardStop = () => {
      clearHardStopTimer();
      hardStopTimer = window.setTimeout(() => {
        hardStopTimer = null;
        forceStopStalledCompletionNotice();
      }, SPOKEN_COMPLETION_MAX_DURATION_MS);
    };
    const scheduleRestoreCheck = (
      delayMs = SPOKEN_COMPLETION_RESTORE_CHECK_MS,
    ) => {
      if (restored) return;
      clearRestoreTimer();
      restoreTimer = window.setTimeout(() => {
        restoreTimer = null;
        if (!completeCompletionNotice()) {
          scheduleRestoreCheck();
        }
      }, delayMs);
    };
    const restoreAfterSpeechEvent = () => {
      if (!completeCompletionNotice()) scheduleRestoreCheck();
    };

    try {
      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 0.86;
      utterance.onend = restoreAfterSpeechEvent;
      utterance.onerror = restoreAfterSpeechEvent;
      ignoreStalledCompletionSpeechRef.current = false;
      scheduleRestoreCheck(SPOKEN_COMPLETION_RESTORE_DELAY_MS);
      scheduleHardStop();
      spokenCompletionNoticeActiveRef.current = true;
      session.setMicrophoneEnabled(false);
      microphoneDisabled = true;
      window.speechSynthesis.speak(utterance);
    } catch {
      spokenCompletionNoticeActiveRef.current = false;
      if (!completeCompletionNotice()) scheduleRestoreCheck();
    }
  }

  function clearTextJobPollTimer(jobId: string) {
    const timer = textJobPollTimersRef.current.get(jobId);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    textJobPollTimersRef.current.delete(jobId);
  }

  function clearTextJobPollTimers() {
    for (const timer of textJobPollTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    textJobPollTimersRef.current.clear();
  }

  function markTextJobCancelling(jobId: string, cancelling: boolean) {
    setCancellingTextJobs((current) => {
      const next = new Set(current);
      if (cancelling) next.add(jobId);
      else next.delete(jobId);
      return next;
    });
  }

  function isChatJobStatus(response: TextChatResponse): response is ChatJobStatus {
    return "job_id" in response && "state" in response;
  }

  function textFromChatResult(result?: TextChatResult): string {
    const display = result?.result?.display?.trim();
    if (display) return display;
    const speakable = result?.result?.speakable?.trim();
    if (speakable) return speakable;
    return `${agentName} finished that reply.`;
  }

  function runningTextJobCopy(restored: boolean): string {
    return restored
      ? "Checking on a background reply from before the refresh. Voice stays available while it finishes."
      : "I'm working on that in the background. You can keep using voice while it finishes.";
  }

  function failedTextJobCopy(status: ChatJobStatus): string {
    const detail = status.error?.detail?.trim();
    if (detail) return `${detail} You can try again or keep using voice.`;
    return `${agentName} could not finish that background reply. You can try again or keep using voice.`;
  }

  function updateTextJobEntry(
    jobId: string,
    patch: Partial<Pick<TranscriptEntry, "text" | "status" | "restored">>,
  ) {
    const meta = textJobEntriesRef.current.get(jobId);
    if (!meta) return;
    setEntries((items) =>
      items.map((entry) =>
        entry.id === meta.entryId ? { ...entry, ...patch } : entry,
      ),
    );
  }

  function finishTextJob(
    jobId: string,
    { keepRecoveryId = false }: { keepRecoveryId?: boolean } = {},
  ) {
    clearTextJobPollTimer(jobId);
    textJobEntriesRef.current.delete(jobId);
    if (!keepRecoveryId) removePendingTextJob(jobId);
    markTextJobCancelling(jobId, false);
  }

  function applyTextJobStatus(status: ChatJobStatus): boolean {
    const meta = textJobEntriesRef.current.get(status.job_id);
    if (!meta) return false;

    if (status.state === "queued" || status.state === "thinking") {
      const partialText = status.partial_text?.trim();
      updateTextJobEntry(status.job_id, {
        status: partialText ? "streaming" : "working",
        text: partialText || runningTextJobCopy(meta.restored),
      });
      return true;
    }

    if (status.state === "complete") {
      updateTextJobEntry(status.job_id, {
        status: "complete",
        text: textFromChatResult(status.result),
        restored: false,
      });
      if (!meta.restored) {
        speakBackgroundCompletionNotice(SPOKEN_COMPLETION_NOTICE_TEXT);
      }
      finishTextJob(status.job_id, { keepRecoveryId: true });
      return false;
    }

    if (status.state === "needs_permission") {
      updateTextJobEntry(status.job_id, {
        status: "needs_permission",
        text:
          "Hermes needs permission before it can continue. Approve the request from your Hermes session, then send a new message when you are ready.",
        restored: false,
      });
      finishTextJob(status.job_id);
      return false;
    }

    if (status.state === "cancelled") {
      updateTextJobEntry(status.job_id, {
        status: "cancelled",
        text: "Cancelled.",
        restored: false,
      });
      finishTextJob(status.job_id);
      return false;
    }

    updateTextJobEntry(status.job_id, {
      status: "failed",
      text: failedTextJobCopy(status),
      restored: false,
    });
    finishTextJob(status.job_id);
    return false;
  }

  function scheduleTextJobPoll(jobId: string, delayMs = TEXT_JOB_POLL_MS) {
    if (!textJobEntriesRef.current.has(jobId)) return;
    clearTextJobPollTimer(jobId);
    const timer = window.setTimeout(() => {
      textJobPollTimersRef.current.delete(jobId);
      void pollTextJob(jobId);
    }, delayMs);
    textJobPollTimersRef.current.set(jobId, timer);
  }

  async function pollTextJob(jobId: string) {
    if (!textJobEntriesRef.current.has(jobId)) return;
    try {
      const status = await getTextJob(jobId);
      if (applyTextJobStatus(status)) scheduleTextJobPoll(jobId);
    } catch (error) {
      clearTextJobPollTimer(jobId);
      if (isAuthFailure(error)) {
        requireAuth(SESSION_EXPIRED_MESSAGE);
        dispatch({ type: "RECOVER" });
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        updateTextJobEntry(jobId, {
          status: "failed",
          text:
            "That background reply is no longer available. Send a new message if you still need it.",
          restored: false,
        });
        finishTextJob(jobId);
        return;
      }
      updateTextJobEntry(jobId, {
        status: "working",
        text:
          "I'm still checking that background reply. Voice stays available while I reconnect.",
      });
      scheduleTextJobPoll(jobId);
    }
  }

  function trackTextJob(jobId: string, entryId: string, restored = false) {
    textJobEntriesRef.current.set(jobId, { entryId, restored });
    savePendingTextJob(jobId);
    scheduleTextJobPoll(jobId);
  }

  function recoverPendingTextJobs() {
    const pendingJobs = readPendingTextJobs();
    for (const { jobId } of pendingJobs) {
      if (textJobEntriesRef.current.has(jobId)) {
        scheduleTextJobPoll(jobId, 0);
        continue;
      }
      const entryId = uid();
      textJobEntriesRef.current.set(jobId, { entryId, restored: true });
      setEntries((items) => [
        ...items,
        {
          id: entryId,
          role: "agent",
          text: runningTextJobCopy(true),
          status: "working",
          at: Date.now(),
          jobId,
          restored: true,
        },
      ]);
      scheduleTextJobPoll(jobId, 0);
    }
  }

  async function cancelBackgroundTextJob(jobId: string) {
    if (!canUsePrivateSession()) return;
    markTextJobCancelling(jobId, true);
    try {
      const status = await cancelTextJob(jobId);
      if (applyTextJobStatus(status)) scheduleTextJobPoll(jobId);
    } catch (error) {
      if (isAuthFailure(error)) {
        clearTextJobPollTimer(jobId);
        requireAuth(SESSION_EXPIRED_MESSAGE);
        dispatch({ type: "RECOVER" });
        return;
      }
      updateTextJobEntry(jobId, {
        status: "working",
        text:
          "I could not cancel that reply from here yet. I will keep checking it.",
      });
      scheduleTextJobPoll(jobId);
    } finally {
      markTextJobCancelling(jobId, false);
    }
  }

  function clearPendingHoldActivation() {
    pendingHoldActivationRef.current = null;
  }

  function clearToolActivity() {
    toolCallsInFlightRef.current.clear();
  }

  function markExpectedProviderCompletionStale(expectsProviderTurnComplete: boolean) {
    settleOpenTranscriptDrafts("cancelled");
    if (!expectsProviderTurnComplete) return;
    staleProviderTurnCompletesRef.current += 1;
    sessionRef.current?.abandonPendingResponse();
  }

  function markCurrentProviderTurnStale() {
    const turn = voiceTurnRef.current;
    if (!turn.waiting || !turn.expectsProviderTurnComplete) return;
    markExpectedProviderCompletionStale(true);
  }

  function stopVoiceTurnWatch() {
    voiceTurnRef.current = {
      ...voiceTurnRef.current,
      waiting: false,
    };
    clearVoiceTurnTimers();
    clearToolActivity();
  }

  function abandonPendingVoiceTurn() {
    settleOpenTranscriptDrafts("cancelled");
    markCurrentProviderTurnStale();
    stopVoiceTurnWatch();
  }

  function resetHoldSpeechState() {
    heardUserDuringHoldRef.current = false;
  }

  function markToolCallStarted(id: string) {
    toolCallsInFlightRef.current.add(id);
    const turn = voiceTurnRef.current;
    if (turn.waiting) {
      turn.usedTool = true;
      turn.heardUser = true;
      clearNoSpeechTimer();
    }
  }

  function markToolCallFinished(id: string) {
    toolCallsInFlightRef.current.delete(id);
  }

  function markCaptureReady(): boolean {
    captureReadyRef.current = true;
    const activateHold = pendingHoldActivationRef.current;
    pendingHoldActivationRef.current = null;
    return activateHold?.() ?? false;
  }

  function markCaptureNotReady({
    preservePendingHoldActivation = false,
  }: { preservePendingHoldActivation?: boolean } = {}) {
    captureReadyRef.current = false;
    clearHandsFreeTurnPending();
    staleProviderTurnCompletesRef.current = 0;
    if (!preservePendingHoldActivation) clearPendingHoldActivation();
  }

  function appendSystem(
    text: string,
    status: TranscriptEntry["status"] = "complete",
  ) {
    setEntries((items) => [
      ...items,
      { id: uid(), role: "system", text, status, at: Date.now() },
    ]);
  }

  function restoreHandsFreeCapture({
    force = false,
    resume = false,
  }: { force?: boolean; resume?: boolean } = {}) {
    if (isSpokenCompletionNoticeBlockingCapture()) return;
    if (!force && stateRef.current.inputMode === "text") return;
    if (resume) sessionRef.current?.resume();
    sessionRef.current?.setHoldToTalk(false);
    sessionRef.current?.setMicrophoneEnabled(!stateRef.current.isMuted);
  }

  function requireAuth(message = "Enter your private PIN to continue.") {
    clearPressTimer();
    clearReconnectTimer();
    clearTokenReconnectTimer();
    finishLiveReconnect();
    liveDesiredRef.current = false;
    stopVoiceTurnWatch();
    abortActiveSpeechCapture();
    speechFinalizingRef.current = false;
    resetHoldSpeechState();
    clearHandsFreeTurnPending();
    textFocusReturnModeRef.current = "none";
    markCaptureNotReady();
    pressRef.current = emptyPress();
    connectingRef.current = false;
    if (sessionRef.current) {
      endingRef.current = true;
      sessionRef.current.setHoldToTalk(false);
      sessionRef.current.disconnect();
      sessionRef.current = null;
      transcriptDraftsRef.current = {};
    }
    void releaseWakeLock();
    setAuthState("needs-pin");
    setAuthError(message);
  }

  function canUsePrivateSession() {
    if (authState === "authenticated") return true;
    if (authState === "needs-pin") requireAuth();
    return false;
  }

  function setVoiceModeImmediate(mode: VoiceMode) {
    voiceModeRef.current = mode;
    setVoiceMode(mode);
  }

  function speechRecognitionUnavailableMessage() {
    return "Hold mode needs browser speech recognition. Switch to Live or type.";
  }

  function speechRecognitionPermissionMessage() {
    return "Microphone blocked. Allow mic access, then hold again.";
  }

  function basicHoldDisclosureMessage() {
    const provider = sttProviderRef.current;
    if (provider === "browser")
      return "Hold-to-talk sends held audio to the private backend, then uses browser text.";
    if (provider === "mock")
      return "Hold-to-talk records held audio for mock transcription, then sends text.";
    return "Hold-to-talk sends held audio to Google Gemini for transcription, then sends text.";
  }

  function discloseBasicHoldTranscription() {
    if (speechRecognitionDisclosureShownRef.current) return;
    speechRecognitionDisclosureShownRef.current = true;
    appendSystem(basicHoldDisclosureMessage());
  }

  async function primeBasicHoldMicrophonePermission({
    reportError = false,
  }: { reportError?: boolean } = {}): Promise<boolean> {
    if (basicHoldMicPermissionPrimedRef.current) return true;
    if (basicHoldMicPermissionPendingRef.current)
      return basicHoldMicPermissionPendingRef.current;

    const getUserMedia = navigator.mediaDevices?.getUserMedia;
    if (typeof getUserMedia !== "function") return true;

    const pending = getUserMedia
      .call(navigator.mediaDevices, { audio: true })
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
        basicHoldMicPermissionPrimedRef.current = true;
        return true;
      })
      .catch(() => {
        if (reportError) {
          appendSystem(speechRecognitionPermissionMessage(), "failed");
          dispatch({
            type: "ERROR",
            error: "Hold-to-talk needs microphone permission.",
          });
        }
        return false;
      })
      .finally(() => {
        basicHoldMicPermissionPendingRef.current = null;
      });

    basicHoldMicPermissionPendingRef.current = pending;
    return pending;
  }

  function speechCaptureText(capture: SpeechCaptureState): string {
    return [capture.finalText, capture.interimText]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  function stopSpeechCaptureAudio(capture: SpeechCaptureState) {
    capture.audio?.close();
    capture.audio = null;
  }

  function notifySpeechCaptureAudioCapped(capture: SpeechCaptureState) {
    if (capture.audioCapNotified) return;
    capture.audioCapNotified = true;
    appendSystem(
      "Captured the first 60 seconds. Release to send, or start another turn for the rest.",
    );
  }

  function startSpeechCaptureAudio(capture: SpeechCaptureState) {
    let audio: BrowserGeminiAudio;
    try {
      audio = new BrowserGeminiAudio();
    } catch {
      return;
    }
    capture.audio = audio;
    void audio
      .startCapture((chunk) => {
        if (
          speechCaptureRef.current !== capture ||
          capture.finished ||
          capture.releaseRequested
        )
          return;
        const bytes =
          Math.floor((chunk.data.length * 3) / 4) -
          (chunk.data.endsWith("==") ? 2 : chunk.data.endsWith("=") ? 1 : 0);
        if (capture.audioBytes + bytes > BASIC_HOLD_STT_AUDIO_BYTE_LIMIT) {
          capture.audioCapped = true;
          notifySpeechCaptureAudioCapped(capture);
          return;
        }
        capture.audioBytes += bytes;
        capture.audioChunksBase64.push(chunk.data);
      })
      .then(() => {
        if (
          speechCaptureRef.current !== capture ||
          capture.finished ||
          capture.releaseRequested ||
          capture.audio !== audio
        )
          audio.close();
      })
      .catch(() => {
        if (capture.audio === audio) capture.audio = null;
        audio.close();
      });
  }

  function updateSpeechCaptureEntry(
    capture: SpeechCaptureState,
    text: string,
    status: TranscriptEntry["status"] = "streaming",
  ) {
    const normalizedText = text.trim();
    if (!normalizedText) return;
    if (!capture.entryId) {
      const entryId = uid();
      capture.entryId = entryId;
      setEntries((items) => [
        ...items,
        {
          id: entryId,
          role: "user",
          text: normalizedText,
          status,
          at: Date.now(),
        },
      ]);
      return;
    }
    setEntries((items) =>
      items.map((entry) =>
        entry.id === capture.entryId
          ? { ...entry, text: normalizedText, status }
          : entry,
      ),
    );
  }

  function clearSpeechCaptureReleaseWatchdog(capture: SpeechCaptureState) {
    if (capture.releaseWatchdogTimer === null) return;
    window.clearTimeout(capture.releaseWatchdogTimer);
    capture.releaseWatchdogTimer = null;
  }

  function clearSpeechCapture(capture: SpeechCaptureState) {
    stopSpeechCaptureAudio(capture);
    clearSpeechCaptureReleaseWatchdog(capture);
    if (speechCaptureRef.current === capture) speechCaptureRef.current = null;
  }

  function recognitionErrorMessage(error: string) {
    if (error === "not-allowed" || error === "service-not-allowed")
      return speechRecognitionPermissionMessage();
    if (error === "audio-capture")
      return "I could not reach the microphone. Check the input, then try again or type.";
    if (error === "language-not-supported")
      return "This browser cannot recognize that language. Switch to Live or type.";
    return "Browser speech recognition stopped early. Try again, switch to Live, or type.";
  }

  function isBlockingSpeechRecognitionError(error: string) {
    return (
      error === "not-allowed" ||
      error === "service-not-allowed" ||
      error === "audio-capture" ||
      error === "language-not-supported"
    );
  }

  function restartSpeechCapture(capture: SpeechCaptureState) {
    if (capture.restartAttempts >= BASIC_HOLD_SPEECH_RESTART_LIMIT)
      return false;
    capture.restartAttempts += 1;
    capture.ended = false;
    try {
      capture.recognition.start();
      return true;
    } catch {
      capture.ended = true;
      return false;
    }
  }

  function settleEndedSpeechCapture(capture: SpeechCaptureState) {
    if (speechCaptureRef.current !== capture || capture.finished) return;
    capture.ended = true;
    if (capture.releaseRequested) {
      finishSpeechCapture(capture);
      return;
    }
    if (restartSpeechCapture(capture)) return;
    finishSpeechCapture(capture);
  }

  function armSpeechCaptureReleaseWatchdog(capture: SpeechCaptureState) {
    clearSpeechCaptureReleaseWatchdog(capture);
    capture.releaseWatchdogTimer = window.setTimeout(() => {
      if (
        speechCaptureRef.current !== capture ||
        capture.finished ||
        !capture.releaseRequested
      )
        return;
      finishSpeechCapture(capture);
    }, BASIC_HOLD_RELEASE_WATCHDOG_MS);
  }

  function abortActiveSpeechCapture() {
    const capture = speechCaptureRef.current;
    if (!capture || capture.finished) return;
    capture.finished = true;
    capture.aborting = true;
    clearSpeechCapture(capture);
    try {
      capture.recognition.abort();
    } catch {
      // The browser may already have ended recognition.
    }
    if (capture.entryId) {
      setEntries((items) =>
        items.map((entry) =>
          entry.id === capture.entryId
            ? { ...entry, status: "cancelled" }
            : entry,
        ),
      );
    }
  }

  function failSpeechCapture(capture: SpeechCaptureState, message: string) {
    if (capture.finished) return;
    capture.finished = true;
    capture.aborting = true;
    clearSpeechCapture(capture);
    try {
      capture.recognition.abort();
    } catch {
      // The browser may already have ended recognition.
    }
    if (capture.entryId) {
      setEntries((items) =>
        items.map((entry) =>
          entry.id === capture.entryId
            ? { ...entry, status: "failed", text: speechCaptureText(capture) || message }
            : entry,
        ),
      );
    }
    appendSystem(message, "failed");
    dispatch({ type: "ERROR", error: "Hold-to-talk could not hear you." });
  }

  function cancelEmptySpeechCapture(capture: SpeechCaptureState) {
    if (capture.entryId) {
      setEntries((items) =>
        items.map((entry) =>
          entry.id === capture.entryId
            ? { ...entry, status: "cancelled", text: "I didn't catch that." }
            : entry,
        ),
      );
    } else {
      appendSystem("I didn't catch that.", "cancelled");
    }
    dispatch({ type: "RECOVER" });
  }

  function failFinishedSpeechCapture(capture: SpeechCaptureState, message: string) {
    if (capture.entryId) {
      setEntries((items) =>
        items.map((entry) =>
          entry.id === capture.entryId
            ? { ...entry, status: "failed", text: message }
            : entry,
        ),
      );
    } else {
      appendSystem(message, "failed");
    }
  }

  function speechTranscriptionTimeoutMs(audioBytes: number) {
    const seconds = audioBytes / BASIC_HOLD_STT_SAMPLE_BYTES_PER_SECOND;
    return Math.min(
      BASIC_HOLD_STT_TIMEOUT_MAX_MS,
      SPEECH_TRANSCRIPTION_TIMEOUT_MS +
        Math.ceil(seconds * BASIC_HOLD_STT_TIMEOUT_PER_SECOND_MS),
    );
  }

  function nudgeFinalizingHold() {
    clearFinalizingNudgeTimer();
    setFinalizingNudge(true);
    finalizingNudgeTimerRef.current = window.setTimeout(() => {
      finalizingNudgeTimerRef.current = null;
      setFinalizingNudge(false);
    }, FINALIZING_NUDGE_MS);
  }

  function submitFinishedSpeechCapture(capture: SpeechCaptureState, text: string) {
    if (!text) {
      cancelEmptySpeechCapture(capture);
      return;
    }
    if (!canUsePrivateSession()) {
      failFinishedSpeechCapture(capture, SESSION_EXPIRED_MESSAGE);
      return;
    }
    dispatch({ type: "THINK" });
    if (capture.entryId) {
      setEntries((items) =>
        items.map((entry) =>
          entry.id === capture.entryId
            ? { ...entry, text, status: "sent" }
            : entry,
        ),
      );
    }
    void submitText(text, { existingUserEntryId: capture.entryId ?? undefined });
  }

  async function finalizeSpeechCaptureTranscript(
    capture: SpeechCaptureState,
    browserText: string,
    audioChunksBase64: string[],
    audioBytes: number,
    audioCapped: boolean,
  ) {
    if (capture.entryId) {
      setEntries((items) =>
        items.map((entry) =>
          entry.id === capture.entryId
            ? {
                ...entry,
                text: browserText,
                status: "sending",
              }
            : entry,
        ),
      );
    }
    try {
      let finalText = browserText;
      if (audioCapped && browserText) {
        submitFinishedSpeechCapture(capture, finalText);
        return;
      }
      if (audioChunksBase64.length > 0) {
        try {
          const result = await transcribeSpeechAudio(
            audioChunksBase64,
            browserText,
            speechTranscriptionTimeoutMs(audioBytes),
          );
          const transcript = result.transcript.trim();
          if (transcript) finalText = transcript;
        } catch (error) {
          if (isAuthFailure(error)) {
            if (capture.entryId) {
              setEntries((items) =>
                items.map((entry) =>
                  entry.id === capture.entryId
                    ? { ...entry, text: browserText || SESSION_EXPIRED_MESSAGE, status: "failed" }
                    : entry,
                ),
              );
            }
            requireAuth(SESSION_EXPIRED_MESSAGE);
            dispatch({ type: "RECOVER" });
            return;
          }
          // Browser recognition remains the fallback if Gemini STT is slow or unavailable.
        }
      }
      submitFinishedSpeechCapture(capture, finalText);
    } finally {
      speechFinalizingRef.current = false;
    }
  }

  function finishSpeechCapture(capture: SpeechCaptureState) {
    if (capture.finished) return;
    capture.finished = true;
    const text = speechCaptureText(capture);
    const audioChunksBase64 = capture.audioChunksBase64.slice();
    const audioBytes = capture.audioBytes;
    const audioCapped = capture.audioCapped;
    clearSpeechCapture(capture);

    if (!text && audioChunksBase64.length === 0) {
      cancelEmptySpeechCapture(capture);
      return;
    }
    speechFinalizingRef.current = true;
    dispatch({ type: "FINALIZE" });
    void finalizeSpeechCaptureTranscript(
      capture,
      text,
      audioChunksBase64,
      audioBytes,
      audioCapped,
    );
  }

  function startBasicHoldRecognition(press: PressState): boolean {
    if (!canUsePrivateSession()) return false;
    if (speechFinalizingRef.current) {
      nudgeFinalizingHold();
      return false;
    }
    if (speechCaptureRef.current && !speechCaptureRef.current.finished)
      return false;
    if (!canEnableMicrophoneCapture() || stateRef.current.inputMode === "text") {
      press.holding = false;
      return false;
    }
    const recognition = createSpeechRecognition();
    if (!recognition) {
      press.holding = false;
      appendSystem(speechRecognitionUnavailableMessage(), "failed");
      dispatch({ type: "ERROR", error: "Hold-to-talk is not available here." });
      return false;
    }

    const capture: SpeechCaptureState = {
      recognition,
      audio: null,
      audioChunksBase64: [],
      audioBytes: 0,
      audioCapped: false,
      audioCapNotified: false,
      entryId: null,
      finalText: "",
      interimText: "",
      ended: false,
      finished: false,
      releaseRequested: false,
      restartAttempts: 0,
      releaseWatchdogTimer: null,
      stopping: false,
      aborting: false,
    };
    speechCaptureRef.current = capture;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      if (speechCaptureRef.current !== capture || capture.finished) return;
      const next = readSpeechRecognitionTranscript(event);
      capture.finalText = [capture.finalText, next.finalText]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");
      capture.interimText = next.interimText;
      if (speechCaptureText(capture)) capture.restartAttempts = 0;
      updateSpeechCaptureEntry(capture, speechCaptureText(capture));
    };
    recognition.onerror = (event) => {
      if (speechCaptureRef.current !== capture || capture.finished) return;
      if (event.error === "aborted" && (capture.stopping || capture.aborting))
        return;
      if (event.error === "no-speech") return;
      if (!isBlockingSpeechRecognitionError(event.error)) return;
      failSpeechCapture(capture, recognitionErrorMessage(event.error));
    };
    recognition.onend = () => {
      if (speechCaptureRef.current !== capture || capture.finished) return;
      settleEndedSpeechCapture(capture);
    };

    try {
      recognition.start();
    } catch {
      failSpeechCapture(
        capture,
        "Speech recognition could not start in this browser. Switch to Live mode or type in the transcript.",
      );
      return false;
    }
    startSpeechCaptureAudio(capture);

    press.activated = true;
    dispatch({ type: "POINTER_DOWN" });
    return true;
  }

  function beginBasicHold(): boolean {
    if (!canUsePrivateSession()) return false;
    if (speechFinalizingRef.current) {
      nudgeFinalizingHold();
      return false;
    }
    if (speechCaptureRef.current && !speechCaptureRef.current.finished)
      return false;
    const press = pressRef.current;
    press.holding = true;
    if (!canEnableMicrophoneCapture() || stateRef.current.inputMode === "text") {
      press.holding = false;
      return false;
    }
    discloseBasicHoldTranscription();

    if (
      basicHoldMicPermissionPrimedRef.current ||
      typeof navigator.mediaDevices?.getUserMedia !== "function"
    ) {
      return startBasicHoldRecognition(press);
    }

    void primeBasicHoldMicrophonePermission({ reportError: true }).then(
      (allowed) => {
        if (!allowed) {
          if (pressRef.current === press) {
            press.holding = false;
            pressRef.current = emptyPress();
          }
          return;
        }
        if (
          pressRef.current !== press ||
          press.released ||
          voiceModeRef.current !== "push-to-talk"
        )
          return;
        startBasicHoldRecognition(press);
      },
    );

    return true;
  }

  function stopBasicHold({ cancel = false }: { cancel?: boolean } = {}) {
    const capture = speechCaptureRef.current;
    if (!capture || capture.finished) return;
    if (cancel) {
      capture.finished = true;
      capture.aborting = true;
      clearSpeechCapture(capture);
      try {
        capture.recognition.abort();
      } catch {
        // The browser may already have ended recognition.
      }
      if (capture.entryId) {
        setEntries((items) =>
          items.map((entry) =>
            entry.id === capture.entryId
              ? { ...entry, status: "cancelled" }
              : entry,
          ),
        );
      }
      dispatch({ type: "RECOVER" });
      return;
    }
    capture.releaseRequested = true;
    stopSpeechCaptureAudio(capture);
    if (capture.ended) {
      finishSpeechCapture(capture);
      return;
    }
    armSpeechCaptureReleaseWatchdog(capture);
    try {
      capture.stopping = true;
      capture.recognition.stop();
    } catch {
      finishSpeechCapture(capture);
    }
  }

  function switchToLiveMode() {
    if (!canUsePrivateSession()) return;
    if (isSpokenCompletionNoticeBlockingCapture()) return;
    stopBasicHold({ cancel: true });
    setVoiceModeImmediate("live");
    void startCall();
  }

  function switchToPushToTalkMode() {
    if (isSpokenCompletionNoticeBlockingCapture()) return;
    if (!browserSupportsSpeechRecognition()) {
      appendSystem(speechRecognitionUnavailableMessage(), "failed");
      return;
    }
    endCall();
    setVoiceModeImmediate("push-to-talk");
    discloseBasicHoldTranscription();
    void primeBasicHoldMicrophonePermission();
  }

  function toggleVoiceMode() {
    if (voiceModeRef.current === "live") {
      switchToPushToTalkMode();
    } else {
      switchToLiveMode();
    }
  }

  async function handlePinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPin = pin.trim();
    if (!normalizedPin) {
      setAuthError("Enter your private PIN.");
      return;
    }

    setAuthSubmitting(true);
    setAuthError("");
    try {
      await login(normalizedPin);
      setAuthState("authenticated");
      setPin("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthError("That PIN was not accepted.");
      } else if (error instanceof ApiError && error.status === 429) {
        setAuthError("Too many attempts. Wait a few minutes, then try again.");
      } else {
        setAuthError("Could not reach the private session. Check Tailscale and reload.");
      }
    } finally {
      setAuthSubmitting(false);
    }
  }

  function appendTranscript(event: RealtimeTranscriptEvent) {
    const role: TranscriptEntry["role"] = event.role;
    const status: TranscriptEntry["status"] = event.final
      ? "complete"
      : "streaming";
    const draftId = transcriptDraftsRef.current[event.role];

    setEntries((items) => {
      const last = items.at(-1);
      if (
        last?.role === role &&
        last.text === event.text &&
        last.status === status
      )
        return items;

      if (draftId) {
        const index = items.findIndex((item) => item.id === draftId);
        if (index >= 0) {
          const next = items.slice();
          next[index] = { ...next[index], text: event.text, status };
          return next;
        }
      }

      const entry: TranscriptEntry = {
        id: uid(),
        role,
        text: event.text,
        status,
        at: Date.now(),
      };
      if (!event.final) transcriptDraftsRef.current[event.role] = entry.id;
      return [...items, entry];
    });

    if (event.final) delete transcriptDraftsRef.current[event.role];
  }

  function settleTranscriptDraft(
    role: RealtimeTranscriptEvent["role"],
    status: TranscriptEntry["status"],
  ) {
    const id = transcriptDraftsRef.current[role];
    if (!id) return;
    setEntries((items) =>
      items.map((entry) =>
        entry.id === id && entry.status === "streaming"
          ? { ...entry, status }
          : entry,
      ),
    );
    delete transcriptDraftsRef.current[role];
  }

  function settleOpenTranscriptDrafts(status: TranscriptEntry["status"]) {
    settleTranscriptDraft("user", status);
    settleTranscriptDraft("agent", status);
  }

  function startVoiceTurnWatch(expectsProviderTurnComplete: boolean) {
    clearVoiceTurnTimers();
    clearToolActivity();
    const turnId = voiceTurnRef.current.id + 1;
    const heardUser = heardUserDuringHoldRef.current;
    resetHoldSpeechState();
    voiceTurnRef.current = {
      id: turnId,
      heardUser,
      heardAgent: false,
      usedTool: false,
      expectsProviderTurnComplete,
      waiting: true,
    };

    if (!heardUser) {
      noSpeechTimerRef.current = window.setTimeout(() => {
        const turn = voiceTurnRef.current;
        if (
          turn.id !== turnId ||
          !turn.waiting ||
          turn.heardUser ||
          turn.heardAgent
        )
          return;
        appendSystem("I didn't catch that.", "cancelled");
        markCurrentProviderTurnStale();
        stopVoiceTurnWatch();
        restoreHandsFreeCapture();
        dispatch({ type: "DONE" });
      }, NO_SPEECH_TIMEOUT_MS);
    }

    armResponseTimer(turnId, INITIAL_RESPONSE_TIMEOUT_MS);
  }

  function armResponseTimer(turnId: number, delayMs: number) {
    clearResponseTimer();
    responseTimerRef.current = window.setTimeout(() => {
      const turn = voiceTurnRef.current;
      if (turn.id !== turnId || !turn.waiting || turn.heardAgent) return;
      if (
        delayMs === INITIAL_RESPONSE_TIMEOUT_MS &&
        (turn.usedTool || toolCallsInFlightRef.current.size > 0)
      ) {
        armResponseTimer(
          turnId,
          TOOL_RESPONSE_TIMEOUT_MS - INITIAL_RESPONSE_TIMEOUT_MS,
        );
        return;
      }
      appendSystem(
        turn.heardUser
          ? `I heard you, but ${agentName} did not return a response.`
          : "I didn't catch that.",
        "failed",
      );
      markCurrentProviderTurnStale();
      stopVoiceTurnWatch();
      restoreHandsFreeCapture();
      dispatch({ type: "DONE" });
    }, delayMs);
  }

  function markVoiceTurnHeard(role: RealtimeTranscriptEvent["role"]) {
    if (role === "user" && stateRef.current.callState === "hold-to-talk") {
      heardUserDuringHoldRef.current = true;
    }
    const turn = voiceTurnRef.current;
    if (!turn.waiting) return;
    if (role === "user") {
      turn.heardUser = true;
      clearNoSpeechTimer();
      return;
    }
    turn.heardAgent = true;
    stopVoiceTurnWatch();
  }

  function shouldIgnoreStaleProviderCallback(): boolean {
    return (
      staleProviderTurnCompletesRef.current > 0 &&
      !voiceTurnRef.current.waiting &&
      stateRef.current.callState !== "agent-speaking"
    );
  }

  function finishVoiceTurnFromProvider() {
    const turn = voiceTurnRef.current;
    if (
      staleProviderTurnCompletesRef.current > 0 &&
      !turn.heardAgent &&
      stateRef.current.callState !== "agent-speaking"
    ) {
      staleProviderTurnCompletesRef.current -= 1;
      return;
    }
    if (turn.heardAgent || stateRef.current.callState === "agent-speaking") {
      staleProviderTurnCompletesRef.current = 0;
    }
    if (
      !turn.heardAgent &&
      toolCallsInFlightRef.current.size > 0 &&
      (turn.waiting || handsFreeTurnPendingRef.current)
    ) {
      if (turn.waiting) armResponseTimer(turn.id, TOOL_RESPONSE_TIMEOUT_MS);
      return;
    }
    clearHandsFreeTurnPending();
    if (turn.waiting && !turn.heardAgent) {
      appendSystem(
        turn.heardUser
          ? `I heard you, but ${agentName} did not return a response.`
          : "I didn't catch that.",
        turn.heardUser ? "failed" : "cancelled",
      );
    }
    stopVoiceTurnWatch();
    resetHoldSpeechState();
    restoreHandsFreeCapture();
    dispatch({ type: "DONE" });
  }

  function isCurrentSessionGeneration(sessionGeneration: number): boolean {
    return sessionGeneration === sessionGenerationRef.current;
  }

  function liveSessionDesired(): boolean {
    return (
      authStateRef.current === "authenticated" &&
      liveDesiredRef.current &&
      voiceModeRef.current === "live" &&
      !endingRef.current
    );
  }

  function liveCaptureIsActive(): boolean {
    const current = stateRef.current;
    return (
      current.inputMode !== "text" &&
      !["idle", "paused", "error"].includes(current.callState)
    );
  }

  function canAutoReconnectLive(): boolean {
    return liveSessionDesired() && liveCaptureIsActive();
  }

  function disconnectLiveSession(session: RealtimeVoiceSession) {
    try {
      session.setHoldToTalk(false);
      session.setMicrophoneEnabled(false);
      session.disconnect();
    } catch {
      // The old socket may already be closing.
    }
  }

  function retireLiveSessionUntilResume() {
    finishLiveReconnect();
    clearTokenReconnectTimer();
    stopVoiceTurnWatch();
    resetHoldSpeechState();
    clearHandsFreeTurnPending();
    markCaptureNotReady();
    const previousSession = sessionRef.current;
    sessionRef.current = null;
    if (!previousSession) return;
    endingRef.current = true;
    try {
      disconnectLiveSession(previousSession);
    } finally {
      endingRef.current = false;
    }
  }

  function createLiveSession(sessionGeneration: number): RealtimeVoiceSession {
    return createDefaultRealtimeVoiceSession({
      callbacks: buildSessionCallbacks(sessionGeneration),
      audio: { startMuted: stateRef.current.isMuted },
      systemInstruction: buildLiveHermesSystemInstruction(agentName),
      requireToolResponseForModelOutput: true,
    });
  }

  async function connectLiveSession(sessionGeneration: number) {
    const session = createLiveSession(sessionGeneration);
    sessionRef.current = session;
    await session.connect();
  }

  function nextSessionGeneration(): number {
    const sessionGeneration = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = sessionGeneration;
    diagnosticsRef.current?.startSession();
    return sessionGeneration;
  }

  function cancelLiveReconnectForUserIntent() {
    if (!reconnectingRef.current) return;
    sessionGenerationRef.current += 1;
    finishLiveReconnect();
    const previousSession = sessionRef.current;
    sessionRef.current = null;
    if (previousSession) disconnectLiveSession(previousSession);
  }

  function scheduleLiveReconnect(reason: string) {
    if (connectingRef.current) return;
    if (!canAutoReconnectLive()) {
      if (liveSessionDesired() && !liveCaptureIsActive()) {
        retireLiveSessionUntilResume();
      }
      return;
    }
    if (
      reconnectingRef.current &&
      (reconnectTimerRef.current !== null || connectingRef.current)
    )
      return;
    if (!reconnectingRef.current) {
      reconnectingRef.current = true;
      reconnectStartedAtRef.current = Date.now();
      reconnectAttemptRef.current = 0;
      appendSystem(`${reason} Reconnecting voice...`, "working");
    }
    stopVoiceTurnWatch();
    resetHoldSpeechState();
    clearHandsFreeTurnPending();
    clearTokenReconnectTimer();
    markCaptureNotReady();
    setAgentConnection({
      state: "checking",
      label: "Reconnecting...",
      detail: "Checking",
    });
    queueLiveReconnectAttempt(0);
  }

  function queueLiveReconnectAttempt(delayMs: number) {
    clearReconnectTimer();
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      void runLiveReconnectAttempt();
    }, delayMs);
  }

  async function runLiveReconnectAttempt() {
    if (!canAutoReconnectLive()) {
      finishLiveReconnect();
      return;
    }
    const attempt = reconnectAttemptRef.current + 1;
    reconnectAttemptRef.current = attempt;
    const delayMs =
      RECONNECT_DELAYS_MS[
        Math.min(attempt - 1, RECONNECT_DELAYS_MS.length - 1)
      ];
    dispatch({ type: "RECONNECT", attempt });
    void refreshAgentConnection();

    if (!canEnableMicrophoneCapture()) {
      const elapsedMs = Date.now() - reconnectStartedAtRef.current;
      if (elapsedMs >= RECONNECT_GIVE_UP_MS) {
        failLiveReconnect();
        return;
      }
      queueLiveReconnectAttempt(delayMs);
      return;
    }

    const previousSession = sessionRef.current;
    const sessionGeneration = nextSessionGeneration();
    sessionLossHandledGenerationRef.current = 0;
    sessionRef.current = null;
    if (previousSession) disconnectLiveSession(previousSession);

    connectingRef.current = true;
    try {
      await connectLiveSession(sessionGeneration);
      if (
        !isCurrentSessionGeneration(sessionGeneration) ||
        !canAutoReconnectLive()
      ) {
        const staleSession = sessionRef.current;
        sessionRef.current = null;
        if (staleSession) disconnectLiveSession(staleSession);
        finishLiveReconnect();
        return;
      }
      finishLiveReconnect();
      appendSystem("Voice reconnected.");
    } catch (error) {
      sessionRef.current = null;
      markCaptureNotReady();
      if (isAuthFailure(error)) {
        finishLiveReconnect();
        requireAuth(SESSION_EXPIRED_MESSAGE);
        dispatch({ type: "RECOVER" });
        return;
      }
      const elapsedMs = Date.now() - reconnectStartedAtRef.current;
      if (elapsedMs >= RECONNECT_GIVE_UP_MS) {
        failLiveReconnect();
        return;
      }
      queueLiveReconnectAttempt(delayMs);
    } finally {
      connectingRef.current = false;
    }
  }

  function finishLiveReconnect() {
    reconnectingRef.current = false;
    reconnectStartedAtRef.current = 0;
    reconnectAttemptRef.current = 0;
    clearReconnectTimer();
  }

  function failLiveReconnect() {
    finishLiveReconnect();
    liveDesiredRef.current = false;
    appendSystem(
      "Voice could not reconnect. Retry.",
      "failed",
    );
    dispatch({
      type: "ERROR",
      error: "Voice disconnected. Retry.",
    });
  }

  function handleLiveSessionLoss(sessionGeneration: number, reason: string) {
    if (!isCurrentSessionGeneration(sessionGeneration)) return;
    if (sessionLossHandledGenerationRef.current === sessionGeneration) return;
    sessionLossHandledGenerationRef.current = sessionGeneration;
    clearTokenReconnectTimer();
    stopVoiceTurnWatch();
    resetHoldSpeechState();
    clearHandsFreeTurnPending();
    markCaptureNotReady();
    void refreshAgentConnection();
    if (endingRef.current) {
      sessionRef.current = null;
      endingRef.current = false;
      return;
    }
    if (canAutoReconnectLive()) {
      const previousSession = sessionRef.current;
      sessionRef.current = null;
      if (previousSession) disconnectLiveSession(previousSession);
      scheduleLiveReconnect(reason);
      return;
    }
    if (liveSessionDesired() && !liveCaptureIsActive()) {
      retireLiveSessionUntilResume();
      return;
    }
    const previousSession = sessionRef.current;
    sessionRef.current = null;
    if (previousSession) disconnectLiveSession(previousSession);
    appendSystem(reason, "failed");
    dispatch({ type: "ERROR", error: "Voice session disconnected." });
  }

  function buildSessionCallbacks(
    sessionGeneration: number,
  ): RealtimeVoiceCallbacks {
    return {
      onToken: (token) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        scheduleTokenReconnect(token.expires_at);
      },
      onStatus: (status) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        if (status === "listening") {
          const activatedPendingHold = markCaptureReady();
          if (!activatedPendingHold) dispatch({ type: "CONNECTED" });
          return;
        }
        if (status === "setup-complete" || status === "connected") {
          dispatch({ type: "CONNECTED" });
          return;
        }
        if (status === "turn-complete") {
          finishVoiceTurnFromProvider();
          return;
        }
        if (status === "agent-speaking") {
          if (shouldIgnoreStaleProviderCallback()) return;
          markVoiceTurnHeard("agent");
          dispatch({ type: "SPEAK" });
          return;
        }
        if (status === "interrupted") {
          dispatch({ type: "INTERRUPT" });
          return;
        }
        if (
          status === "closed" &&
          !connectingRef.current &&
          !endingRef.current
        ) {
          handleLiveSessionLoss(sessionGeneration, "Voice closed.");
        }
      },
      onTranscript: (event) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        if (event.role === "agent" && shouldIgnoreStaleProviderCallback())
          return;
        markHandsFreeTurnPending(event);
        markVoiceTurnHeard(event.role);
        appendTranscript(event);
      },
      onToolCall: (call) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        if (shouldIgnoreStaleProviderCallback()) return;
        markToolCallStarted(call.id);
      },
      onToolResponse: (response) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        if (shouldIgnoreStaleProviderCallback()) return;
        markToolCallFinished(response.id);
      },
      onDiagnosticsEvent: (event) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        diagnosticsRef.current?.record(event);
      },
      onError: (error) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        if (isAuthFailure(error)) {
          requireAuth(SESSION_EXPIRED_MESSAGE);
          dispatch({ type: "RECOVER" });
          return;
        }
        handleLiveSessionLoss(
          sessionGeneration,
          error.message || "Realtime voice session reported an error.",
        );
      },
      onClose: () => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        handleLiveSessionLoss(sessionGeneration, "Voice closed.");
      },
    };
  }

  async function startCall() {
    if (!canUsePrivateSession()) return;
    if (isSpokenCompletionNoticeBlockingCapture()) return;
    if (connectingRef.current || stateRef.current.callState === "connecting")
      return;
    liveDesiredRef.current = true;
    if (sessionRef.current) {
      textFocusReturnModeRef.current = "none";
      sessionRef.current.resume();
      sessionRef.current.setMicrophoneEnabled(
        !stateRef.current.isMuted && canEnableMicrophoneCapture(),
      );
      dispatch({ type: "RESUME" });
      if (captureReadyRef.current) markCaptureReady();
      return;
    }

    connectingRef.current = true;
    endingRef.current = false;
    finishLiveReconnect();
    markCaptureNotReady({ preservePendingHoldActivation: true });
    const sessionGeneration = nextSessionGeneration();
    sessionLossHandledGenerationRef.current = 0;
    dispatch({ type: "CONNECT" });

    try {
      await connectLiveSession(sessionGeneration);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Could not connect to realtime voice.";
      if (isCurrentSessionGeneration(sessionGeneration)) {
        diagnosticsRef.current?.mark("session_error", { message: errorMessage });
      }
      sessionRef.current = null;
      markCaptureNotReady();
      if (isAuthFailure(error)) {
        requireAuth(SESSION_EXPIRED_MESSAGE);
        dispatch({ type: "RECOVER" });
        return;
      }
      liveDesiredRef.current = false;
      appendSystem(errorMessage, "failed");
      dispatch({
        type: "ERROR",
        error:
          `Could not prepare ${agentNounLower} voice. Confirm you are on the private network and try again.`,
      });
    } finally {
      connectingRef.current = false;
    }
  }

  function pauseCall() {
    textFocusReturnModeRef.current = "none";
    abandonPendingVoiceTurn();
    resetHoldSpeechState();
    clearHandsFreeTurnPending();
    sessionRef.current?.setMicrophoneEnabled(false);
    sessionRef.current?.setHoldToTalk(false);
    dispatch({ type: "PAUSE" });
  }

  function resumeCall() {
    if (!canEnableMicrophoneCapture()) return;
    textFocusReturnModeRef.current = "none";
    if (!sessionRef.current) {
      void startCall();
      return;
    }
    stopVoiceTurnWatch();
    resetHoldSpeechState();
    clearHandsFreeTurnPending();
    sessionRef.current?.resume();
    sessionRef.current?.setMicrophoneEnabled(
      !stateRef.current.isMuted && canEnableMicrophoneCapture(),
    );
    dispatch({ type: "RESUME" });
  }

  function endCall() {
    clearPressTimer();
    clearReconnectTimer();
    clearTokenReconnectTimer();
    finishLiveReconnect();
    sessionGenerationRef.current += 1;
    liveDesiredRef.current = false;
    stopVoiceTurnWatch();
    resetHoldSpeechState();
    clearHandsFreeTurnPending();
    textFocusReturnModeRef.current = "none";
    markCaptureNotReady();
    pressRef.current = emptyPress();
    endingRef.current = true;
    sessionRef.current?.setHoldToTalk(false);
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    transcriptDraftsRef.current = {};
    void releaseWakeLock();
    dispatch({ type: "RECOVER" });
  }

  function handleTap() {
    if (!canUsePrivateSession()) return;
    const current = stateRef.current;
    if (current.inputMode === "text") return;
    if (current.callState === "idle" || current.callState === "error") {
      void startCall();
      return;
    }
    if (current.callState === "paused") {
      resumeCall();
      return;
    }
    if (
      current.callState === "listening" ||
      current.callState === "user-speaking"
    ) {
      pauseCall();
    }
  }

  function handleRetry() {
    if (!canUsePrivateSession()) return;
    if (voiceModeRef.current === "push-to-talk") {
      dispatch({ type: "RECOVER" });
      return;
    }
    void startCall();
  }

  function beginHold() {
    if (!canUsePrivateSession()) return;
    const press = pressRef.current;
    press.holding = true;
    if (!canEnableMicrophoneCapture()) return false;
    const current = stateRef.current;
    if (current.inputMode === "text") return false;

    const activateHold = () => {
      if (press.released || pressRef.current !== press) return false;
      if (!canEnableMicrophoneCapture()) return false;
      abandonPendingVoiceTurn();
      press.activated = true;
      resetHoldSpeechState();
      sessionRef.current?.setHoldToTalk(true);
      sessionRef.current?.setMicrophoneEnabled(true);
      if (stateRef.current.callState === "agent-speaking")
        sessionRef.current?.interrupt();
      dispatch({ type: "POINTER_DOWN" });
      return true;
    };

    if (current.callState === "idle" || current.callState === "error") {
      pendingHoldActivationRef.current = activateHold;
      void startCall();
    } else if (current.callState === "connecting" || !captureReadyRef.current) {
      pendingHoldActivationRef.current = activateHold;
    } else {
      activateHold();
    }
  }

  function cancelPress() {
    if (voiceModeRef.current === "push-to-talk") {
      if (pressRef.current.pointerId === null && !pressRef.current.holding)
        return;
      clearPressTimer();
      stopBasicHold({ cancel: true });
      pressRef.current = emptyPress();
      clearPendingHoldActivation();
      return;
    }
    clearPressTimer();
    const press = pressRef.current;
    press.released = true;
    const wasHolding = press.holding;
    pressRef.current = emptyPress();
    if (wasHolding) {
      if (press.activated) {
        const expectsProviderTurnComplete =
          sessionRef.current?.finalizeInputTurn() ?? false;
        markExpectedProviderCompletionStale(expectsProviderTurnComplete);
        restoreHandsFreeCapture();
      } else {
        sessionRef.current?.setHoldToTalk(false);
      }
      stopVoiceTurnWatch();
      resetHoldSpeechState();
      clearPendingHoldActivation();
      dispatch({ type: "POINTER_CANCEL" });
    }
  }

  function handlePointerDown(e: PointerEvent<HTMLButtonElement>) {
    exitTextModeForOrbPress();
    if (
      e.button !== 0 ||
      pressRef.current.pointerId !== null
    )
      return;
    if (!canUsePrivateSession()) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pressRef.current = {
      pointerId: e.pointerId,
      timer: window.setTimeout(
        voiceModeRef.current === "push-to-talk" ? beginBasicHold : beginHold,
        HOLD_DELAY_MS,
      ),
      holding: false,
      activated: false,
      released: false,
    };
  }

  function handlePointerUp(e: PointerEvent<HTMLButtonElement>) {
    if (pressRef.current.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    clearPressTimer();
    const press = pressRef.current;
    press.released = true;
    const wasHolding = press.holding;
    const wasActivated = press.activated;
    pressRef.current = emptyPress();
    if (wasHolding) {
      if (voiceModeRef.current === "push-to-talk") {
        stopBasicHold();
      } else if (wasActivated) {
        const expectsProviderTurnComplete =
          sessionRef.current?.finalizeInputTurn() ?? false;
        sessionRef.current?.setHoldToTalk(false);
        dispatch({ type: "POINTER_UP" });
        startVoiceTurnWatch(expectsProviderTurnComplete);
      } else {
        sessionRef.current?.setHoldToTalk(false);
        clearPendingHoldActivation();
      }
    } else {
      if (voiceModeRef.current === "live") handleTap();
    }
  }

  function toggleMute() {
    const nextMuted = !stateRef.current.isMuted;
    textFocusReturnModeRef.current = "none";
    resetHoldSpeechState();
    sessionRef.current?.setMicrophoneEnabled(
      !nextMuted && canEnableMicrophoneCapture(),
    );
    dispatch({ type: nextMuted ? "MUTE" : "UNMUTE" });
  }

  function toggleSpokenCompletionNotifications() {
    setSpokenCompletionNotificationsEnabled((enabled) => {
      const next = !enabled;
      spokenCompletionNotificationsEnabledRef.current = next;
      saveSpokenCompletionNotificationsEnabled(next);
      return next;
    });
  }

  function focusText() {
    textFocusEpochRef.current += 1;
    textComposerFocusedRef.current = true;
    cancelLiveReconnectForUserIntent();
    const current = stateRef.current;
    if (
      current.inputMode !== "text" &&
      textFocusReturnModeRef.current === "none"
    ) {
      const captureWasActive =
        sessionRef.current !== null &&
        !current.isMuted &&
        ["listening", "user-speaking", "hold-to-talk", "agent-thinking"].includes(
          current.callState,
        );
      textFocusReturnModeRef.current = captureWasActive
        ? "restore-capture"
        : current.callState === "paused"
          ? "paused"
          : current.callState === "muted"
            ? "muted"
            : "none";
    }
    abandonPendingVoiceTurn();
    resetHoldSpeechState();
    sessionRef.current?.setMicrophoneEnabled(false);
    sessionRef.current?.setHoldToTalk(false);
    dispatch({ type: "SET_DRAWER", drawer: "open" });
    dispatch({ type: "FOCUS_TEXT" });
  }

  function blurText() {
    textComposerFocusedRef.current = false;
    dispatch({ type: "BLUR_TEXT" });
  }

  function exitTextModeForOrbPress() {
    if (stateRef.current.inputMode !== "text") return;
    textFocusReturnModeRef.current = "none";
    stateRef.current = { ...stateRef.current, inputMode: "hands-free" };
    dispatch({ type: "BLUR_TEXT" });
  }

  function dispatchTextTurnFinished(returnMode: TextFocusReturnMode) {
    if (returnMode === "none" && !sessionRef.current) {
      dispatch({ type: "RECOVER" });
      return;
    }
    dispatch({
      type:
        returnMode === "paused"
          ? "PAUSE"
          : returnMode === "muted"
            ? "MUTE"
            : "DONE",
    });
  }

  function completeTextTurn(submitFocusEpoch: number) {
    const returnMode = textFocusReturnModeRef.current;
    const refocusedAfterSubmit =
      textFocusEpochRef.current !== submitFocusEpoch &&
      stateRef.current.inputMode === "text";
    if (refocusedAfterSubmit) {
      dispatchTextTurnFinished(returnMode);
      dispatch({ type: "FOCUS_TEXT" });
      sessionRef.current?.setMicrophoneEnabled(false);
      return;
    }
    textFocusReturnModeRef.current = "none";
    if (returnMode === "restore-capture") {
      dispatch({ type: "DONE" });
      if (!sessionRef.current) {
        void startCall();
        return;
      }
      // DONE exits text mode, but stateRef can be one render behind here.
      restoreHandsFreeCapture({ force: true, resume: true });
      return;
    }
    dispatchTextTurnFinished(returnMode);
  }

  async function submitText(
    text: string,
    { existingUserEntryId }: { existingUserEntryId?: string } = {},
  ) {
    if (!canUsePrivateSession()) return;
    const submitFocusEpoch = textFocusEpochRef.current;
    abandonPendingVoiceTurn();
    resetHoldSpeechState();
    if (existingUserEntryId) {
      setEntries((items) =>
        items.map((entry) =>
          entry.id === existingUserEntryId
            ? { ...entry, text, status: "sent" }
            : entry,
        ),
      );
    } else {
      const user: TranscriptEntry = {
        id: uid(),
        role: "user",
        text,
        status: "sent",
        at: Date.now(),
      };
      setEntries((items) => [...items, user]);
    }
    try {
      const res = await sendText(text, entriesRef.current);
      if (isChatJobStatus(res)) {
        const entryId = uid();
        setEntries((items) => [
          ...items,
          {
            id: entryId,
            role: "agent",
            text: runningTextJobCopy(false),
            status: "working",
            at: Date.now(),
            jobId: res.job_id,
          },
        ]);
        trackTextJob(res.job_id, entryId);
        applyTextJobStatus(res);
        completeTextTurn(submitFocusEpoch);
        return;
      }
      setEntries((items) => [
        ...items,
        {
          id: uid(),
          role: "agent",
          text: textFromChatResult(res),
          status: "complete",
          at: Date.now(),
        },
      ]);
      dispatch({ type: "SPEAK" });
      window.setTimeout(() => {
        completeTextTurn(submitFocusEpoch);
      }, 900);
    } catch (error) {
      if (isAuthFailure(error)) {
        requireAuth(SESSION_EXPIRED_MESSAGE);
        dispatch({ type: "RECOVER" });
        return;
      }
      if (error instanceof ApiRequestTimeoutError) {
        appendSystem(
          "I could not start that background reply. Check the connection, then try again or use voice.",
          "failed",
        );
        dispatch({ type: "ERROR", error: "Text chat could not start." });
        return;
      }
      appendSystem(
        `Text chat could not reach ${agentNounLower}. You can try again or use voice.`,
        "failed",
      );
      dispatch({ type: "ERROR", error: "Text chat failed." });
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <header className="topbar">
          <div>
            <span className="eyebrow">private voice control</span>
            <h1>{agentName}</h1>
          </div>
          <div
            className={`agent-connection state-${agentConnection.state}`}
            aria-label={`Agent connection: ${agentConnection.label}`}
          >
            <span aria-hidden="true" />
            <div>
              <strong>{agentConnection.label}</strong>
              <small>{agentConnection.detail}</small>
            </div>
          </div>
        </header>
        <VoiceOrb
          state={state}
          mode={voiceMode}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelPress}
          onRetry={handleRetry}
          nudging={finalizingNudge}
          agentName={agentName}
        />
        <div className="control-row">
          {voiceMode === "live" ? (
            <button type="button" onClick={toggleMute}>
              {state.isMuted ? <MicOff /> : <Mic />}
              {state.isMuted ? "Unmute" : "Mute"}
            </button>
          ) : null}
          <button
            type="button"
            className="mode-toggle"
            onClick={toggleVoiceMode}
            title={
              voiceMode === "live"
                ? "Switch to hold-to-talk mode"
                : "Switch to Live mode"
            }
          >
            {voiceMode === "live" ? <Hand /> : <Radio />}
            {voiceMode === "live" ? "Hold" : "Live"}
          </button>
          <button
            type="button"
            className="completion-notice-toggle"
            onClick={toggleSpokenCompletionNotifications}
            aria-pressed={spokenCompletionNotificationsEnabled}
            aria-label={
              spokenCompletionNotificationsEnabled
                ? "Turn off spoken completion notices"
                : "Turn on spoken completion notices"
            }
            title={
              spokenCompletionNotificationsEnabled
                ? "Spoken completion notices on"
                : "Spoken completion notices off"
            }
          >
            {spokenCompletionNotificationsEnabled ? <Volume2 /> : <VolumeX />}
            Notify
          </button>
        </div>
      </section>
      <TranscriptDrawer
        drawer={state.drawer}
        entries={entries}
        agentName={agentName}
        agentNoun={agentNounLower}
        onSubmit={submitText}
        onCancelJob={cancelBackgroundTextJob}
        cancellingJobIds={cancellingTextJobs}
        onFocus={focusText}
        onBlur={blurText}
        onToggle={() =>
          dispatch({
            type: "SET_DRAWER",
            drawer: state.drawer === "open" ? "peeking" : "open",
          })
        }
      />
      {authState !== "authenticated" ? (
        <AuthGate
          status={authState}
          agentName={agentName}
          pin={pin}
          error={authError}
          submitting={authSubmitting}
          onPinChange={setPin}
          onSubmit={handlePinSubmit}
        />
      ) : null}
    </main>
  );
}
