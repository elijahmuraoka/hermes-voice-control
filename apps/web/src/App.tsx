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
  Sparkles,
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
import { FloatingChat } from "./components/FloatingChat";
import { agentName, agentNounLower } from "./config";
import {
  createHvcDiagnosticsRecorder,
  exposeHvcDiagnostics,
  type HvcDiagnosticsRecorder,
} from "./diagnostics";
import "./styles.css";

const uid = () => Math.random().toString(36).slice(2);
const HOLD_DELAY_MS = 220;

type PressState = {
  pointerId: number | null;
  timer: number | null;
  holding: boolean;
  released: boolean;
};

type AuthState = "checking" | "authenticated" | "needs-pin";

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
  const [tokenMode, setTokenMode] = useState("local");
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

  function appendSystem(
    text: string,
    status: TranscriptEntry["status"] = "complete",
  ) {
    setEntries((items) => [
      ...items,
      { id: uid(), role: "system", text, status, at: Date.now() },
    ]);
  }

  function requireAuth(message = "Enter your private PIN to continue.") {
    clearPressTimer();
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
    } catch {
      setAuthError("That PIN was not accepted.");
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

  function isCurrentSessionGeneration(sessionGeneration: number): boolean {
    return sessionGeneration === sessionGenerationRef.current;
  }

  function buildSessionCallbacks(
    sessionGeneration: number,
  ): RealtimeVoiceCallbacks {
    return {
      onToken: (token) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        setTokenMode(token.mode);
      },
      onStatus: (status) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        if (
          status === "setup-complete" ||
          status === "connected" ||
          status === "listening"
        ) {
          dispatch({ type: "CONNECTED" });
          return;
        }
        if (status === "agent-speaking") {
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
          appendSystem("Voice session closed.");
          dispatch({ type: "RECOVER" });
        }
      },
      onTranscript: (event) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        appendTranscript(event);
      },
      onToolCall: (call) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        appendSystem(`${agentName} is using ${call.name}.`, "streaming");
      },
      onToolResponse: (response) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        appendSystem(`${response.name} finished.`, "complete");
      },
      onDiagnosticsEvent: (event) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        diagnosticsRef.current?.record(event);
      },
      onError: (error) => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        if (isAuthFailure(error)) {
          requireAuth("Session expired. Enter your private PIN again.");
          dispatch({ type: "RECOVER" });
          return;
        }
        appendSystem(
          error.message || "Realtime voice session reported an error.",
          "failed",
        );
        dispatch({ type: "ERROR", error: "Voice session failed." });
      },
      onClose: () => {
        if (!isCurrentSessionGeneration(sessionGeneration)) return;
        sessionRef.current = null;
        endingRef.current = false;
      },
    };
  }

  async function startCall(afterConnected?: () => void) {
    if (!canUsePrivateSession()) return;
    if (connectingRef.current || stateRef.current.callState === "connecting")
      return;
    if (sessionRef.current) {
      sessionRef.current.resume();
      sessionRef.current.setMicrophoneEnabled(!stateRef.current.isMuted);
      dispatch({ type: "RESUME" });
      afterConnected?.();
      return;
    }

    connectingRef.current = true;
    endingRef.current = false;
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
      afterConnected?.();
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Could not connect to realtime voice.";
      if (isCurrentSessionGeneration(sessionGeneration)) {
        diagnosticsRef.current?.mark("session_error", { message: errorMessage });
      }
      sessionRef.current = null;
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
    sessionRef.current?.setMicrophoneEnabled(false);
    sessionRef.current?.setHoldToTalk(false);
    dispatch({ type: "PAUSE" });
  }

  function resumeCall() {
    sessionRef.current?.resume();
    sessionRef.current?.setMicrophoneEnabled(!stateRef.current.isMuted);
    dispatch({ type: "RESUME" });
  }

  function endCall() {
    clearPressTimer();
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
    if (current.inputMode === "text") return;

    const activateHold = () => {
      sessionRef.current?.setHoldToTalk(true);
      sessionRef.current?.setMicrophoneEnabled(true);
      if (stateRef.current.callState === "agent-speaking")
        sessionRef.current?.interrupt();
      dispatch({ type: "POINTER_DOWN" });
    };

    if (current.callState === "idle" || current.callState === "error") {
      void startCall(() => {
        if (!press.released) activateHold();
      });
    } else {
      activateHold();
    }
  }

  function cancelPress() {
    clearPressTimer();
    const wasHolding = pressRef.current.holding;
    pressRef.current = emptyPress();
    if (wasHolding) {
      sessionRef.current?.setHoldToTalk(false);
      dispatch({ type: "POINTER_CANCEL" });
    }
  }

  function handlePointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (
      e.button !== 0 ||
      pressRef.current.pointerId !== null ||
      stateRef.current.inputMode === "text"
    )
      return;
    if (!canUsePrivateSession()) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pressRef.current = {
      pointerId: e.pointerId,
      timer: window.setTimeout(beginHold, HOLD_DELAY_MS),
      holding: false,
      released: false,
    };
  }

  function handlePointerUp(e: PointerEvent<HTMLButtonElement>) {
    if (pressRef.current.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    clearPressTimer();
    const wasHolding = pressRef.current.holding;
    pressRef.current = emptyPress();
    if (wasHolding) {
      sessionRef.current?.setHoldToTalk(false);
      dispatch({ type: "POINTER_UP" });
    } else {
      handleTap();
    }
  }

  function toggleMute() {
    const nextMuted = !stateRef.current.isMuted;
    sessionRef.current?.setMicrophoneEnabled(!nextMuted);
    dispatch({ type: nextMuted ? "MUTE" : "UNMUTE" });
  }

  function focusText() {
    sessionRef.current?.setMicrophoneEnabled(false);
    sessionRef.current?.setHoldToTalk(false);
    dispatch({ type: "FOCUS_TEXT" });
  }

  function blurText() {
    dispatch({ type: "BLUR_TEXT" });
  }

  async function submitText(text: string) {
    if (!canUsePrivateSession()) return;
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
      window.setTimeout(() => dispatch({ type: "DONE" }), 900);
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
          <div className="status-pill">
            <Sparkles size={14} />
            {tokenMode} voice
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
        <FloatingChat
          onSubmit={submitText}
          onFocus={focusText}
          onBlur={blurText}
          agentNoun={agentNounLower}
        />
      </section>
      <TranscriptDrawer
        drawer={state.drawer}
        entries={entries}
        agentName={agentName}
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
