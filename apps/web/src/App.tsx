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
  KeyRound,
  LoaderCircle,
  Mic,
  MicOff,
  PhoneOff,
} from "lucide-react";
import { ApiError, getSession, login, sendText } from "./api";
import {
  createDefaultRealtimeVoiceSession,
  type RealtimeTranscriptEvent,
  type RealtimeVoiceCallbacks,
  type RealtimeVoiceSession,
} from "./realtime";
import { initialVoiceState, voiceReducer } from "./stateMachine";
import type { TranscriptEntry } from "./types";
import { VoiceOrb } from "./components/VoiceOrb";
import { TranscriptDrawer } from "./components/TranscriptDrawer";
import { agentName, agentNounLower } from "./config";
import {
  createHvcDiagnosticsRecorder,
  exposeHvcDiagnostics,
  type HvcDiagnosticsRecorder,
} from "./diagnostics";
import "./styles.css";

const uid = () => Math.random().toString(36).slice(2);
const HOLD_DELAY_MS = 220;
const NO_SPEECH_TIMEOUT_MS = 3500;
const INITIAL_RESPONSE_TIMEOUT_MS = 14000;
const TOOL_RESPONSE_TIMEOUT_MS = 95000;

type PressState = {
  pointerId: number | null;
  timer: number | null;
  holding: boolean;
  activated: boolean;
  released: boolean;
};

type AuthState = "checking" | "authenticated" | "needs-pin";

type VoiceTurn = {
  id: number;
  heardUser: boolean;
  heardAgent: boolean;
  usedTool: boolean;
  expectsProviderTurnComplete: boolean;
  waiting: boolean;
};

type TextFocusReturnMode = "none" | "restore-capture" | "paused" | "muted";

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
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const stateRef = useRef(state);
  const entriesRef = useRef(entries);
  const sessionRef = useRef<RealtimeVoiceSession | null>(null);
  const diagnosticsRef = useRef<HvcDiagnosticsRecorder | null>(null);
  const sessionGenerationRef = useRef(0);
  const connectingRef = useRef(false);
  const endingRef = useRef(false);
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
  const initialPressState = useMemo(emptyPress, []);
  const pressRef = useRef<PressState>(initialPressState);

  if (diagnosticsRef.current === null) {
    diagnosticsRef.current = createHvcDiagnosticsRecorder();
  }

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    exposeHvcDiagnostics(diagnosticsRef.current);
    const cancel = () => cancelPress();
    const visibility = () => {
      if (document.visibilityState === "hidden") cancelPress();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    const currentEndingRef = endingRef;
    const currentSessionRef = sessionRef;
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", visibility);
      clearPressTimer();
      clearVoiceTurnTimers();
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
    if (!force && stateRef.current.inputMode === "text") return;
    if (resume) sessionRef.current?.resume();
    sessionRef.current?.setHoldToTalk(false);
    sessionRef.current?.setMicrophoneEnabled(!stateRef.current.isMuted);
  }

  function requireAuth(message = "Enter your private PIN to continue.") {
    clearPressTimer();
    stopVoiceTurnWatch();
    resetHoldSpeechState();
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
    setAuthState("needs-pin");
    setAuthError(message);
  }

  function canUsePrivateSession() {
    if (authState === "authenticated") return true;
    if (authState === "needs-pin") requireAuth();
    return false;
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
      turn.waiting &&
      !turn.heardAgent &&
      toolCallsInFlightRef.current.size > 0
    ) {
      armResponseTimer(turn.id, TOOL_RESPONSE_TIMEOUT_MS);
      return;
    }
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

  function buildSessionCallbacks(
    sessionGeneration: number,
  ): RealtimeVoiceCallbacks {
    return {
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
          markCaptureNotReady();
          appendSystem("Voice session closed.");
          dispatch({ type: "RECOVER" });
        }
      },
      onTranscript: (event) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        if (event.role === "agent" && shouldIgnoreStaleProviderCallback())
          return;
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
        markCaptureNotReady();
        if (isAuthFailure(error)) {
          requireAuth("Session expired. Enter your private PIN again.");
          dispatch({ type: "RECOVER" });
          return;
        }
        stopVoiceTurnWatch();
        resetHoldSpeechState();
        appendSystem(
          error.message || "Realtime voice session reported an error.",
          "failed",
        );
        dispatch({ type: "ERROR", error: "Voice session failed." });
      },
      onClose: () => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        stopVoiceTurnWatch();
        resetHoldSpeechState();
        markCaptureNotReady();
        sessionRef.current = null;
        endingRef.current = false;
      },
    };
  }

  async function startCall() {
    if (!canUsePrivateSession()) return;
    if (connectingRef.current || stateRef.current.callState === "connecting")
      return;
    if (sessionRef.current) {
      textFocusReturnModeRef.current = "none";
      sessionRef.current.resume();
      sessionRef.current.setMicrophoneEnabled(!stateRef.current.isMuted);
      dispatch({ type: "RESUME" });
      if (captureReadyRef.current) markCaptureReady();
      return;
    }

    connectingRef.current = true;
    endingRef.current = false;
    markCaptureNotReady({ preservePendingHoldActivation: true });
    const sessionGeneration = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = sessionGeneration;
    diagnosticsRef.current?.startSession();
    dispatch({ type: "CONNECT" });

    try {
      const session = createDefaultRealtimeVoiceSession({
        callbacks: buildSessionCallbacks(sessionGeneration),
        audio: { startMuted: stateRef.current.isMuted },
      });
      sessionRef.current = session;
      await session.connect();
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
        requireAuth("Session expired. Enter your private PIN again.");
        dispatch({ type: "RECOVER" });
        return;
      }
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
    sessionRef.current?.setMicrophoneEnabled(false);
    sessionRef.current?.setHoldToTalk(false);
    dispatch({ type: "PAUSE" });
  }

  function resumeCall() {
    textFocusReturnModeRef.current = "none";
    stopVoiceTurnWatch();
    resetHoldSpeechState();
    sessionRef.current?.resume();
    sessionRef.current?.setMicrophoneEnabled(!stateRef.current.isMuted);
    dispatch({ type: "RESUME" });
  }

  function endCall() {
    clearPressTimer();
    stopVoiceTurnWatch();
    resetHoldSpeechState();
    textFocusReturnModeRef.current = "none";
    markCaptureNotReady();
    pressRef.current = emptyPress();
    endingRef.current = true;
    sessionRef.current?.setHoldToTalk(false);
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    transcriptDraftsRef.current = {};
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

  function beginHold() {
    if (!canUsePrivateSession()) return;
    const press = pressRef.current;
    press.holding = true;
    const current = stateRef.current;
    if (current.inputMode === "text") return false;

    const activateHold = () => {
      if (press.released || pressRef.current !== press) return false;
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
      timer: window.setTimeout(beginHold, HOLD_DELAY_MS),
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
      if (wasActivated) {
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
      handleTap();
    }
  }

  function toggleMute() {
    const nextMuted = !stateRef.current.isMuted;
    textFocusReturnModeRef.current = "none";
    resetHoldSpeechState();
    sessionRef.current?.setMicrophoneEnabled(!nextMuted);
    dispatch({ type: nextMuted ? "MUTE" : "UNMUTE" });
  }

  function focusText() {
    textFocusEpochRef.current += 1;
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
    dispatch({ type: "BLUR_TEXT" });
  }

  function exitTextModeForOrbPress() {
    if (stateRef.current.inputMode !== "text") return;
    textFocusReturnModeRef.current = "none";
    stateRef.current = { ...stateRef.current, inputMode: "hands-free" };
    dispatch({ type: "BLUR_TEXT" });
  }

  function dispatchTextTurnFinished(returnMode: TextFocusReturnMode) {
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
      // DONE exits text mode, but stateRef can be one render behind here.
      restoreHandsFreeCapture({ force: true, resume: true });
      return;
    }
    dispatchTextTurnFinished(returnMode);
  }

  async function submitText(text: string) {
    if (!canUsePrivateSession()) return;
    const submitFocusEpoch = textFocusEpochRef.current;
    abandonPendingVoiceTurn();
    resetHoldSpeechState();
    dispatch({ type: "THINK" });
    const user: TranscriptEntry = {
      id: uid(),
      role: "user",
      text,
      status: "sent",
      at: Date.now(),
    };
    setEntries((items) => [...items, user]);
    try {
      const res = await sendText(text, entriesRef.current);
      setEntries((items) => [
        ...items,
        {
          id: uid(),
          role: "agent",
          text: res.result.display,
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
        requireAuth("Session expired. Enter your private PIN again.");
        dispatch({ type: "RECOVER" });
        return;
      }
      appendSystem(
        `Text fallback could not reach ${agentNounLower}. The draft was not lost by the server because it never left this UI successfully.`,
        "failed",
      );
      dispatch({ type: "ERROR", error: "Text fallback failed." });
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
        </header>
        <VoiceOrb
          state={state}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelPress}
          agentName={agentName}
        />
        <div className="control-row">
          <button type="button" onClick={toggleMute}>
            {state.isMuted ? <MicOff /> : <Mic />}
            {state.isMuted ? "Unmute" : "Mute"}
          </button>
          <button type="button" className="danger" onClick={endCall}>
            <PhoneOff />
            End
          </button>
        </div>
      </section>
      <TranscriptDrawer
        drawer={state.drawer}
        entries={entries}
        agentName={agentName}
        agentNoun={agentNounLower}
        onSubmit={submitText}
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
