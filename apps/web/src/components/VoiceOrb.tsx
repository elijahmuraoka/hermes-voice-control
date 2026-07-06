import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { CallState } from "../types";
import { stateLabel } from "../stateMachine";
import type { VoiceMode, VoiceState } from "../types";
interface Props {
  state: VoiceState;
  mode: VoiceMode;
  agentName: string;
  onPointerDown: React.PointerEventHandler<HTMLButtonElement>;
  onPointerUp: React.PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: React.PointerEventHandler<HTMLButtonElement>;
  onRetry: () => void;
  audioLevelRef?: RefObject<number>;
  nudging?: boolean;
  nudgeKey?: number;
}

const LEVEL_ACTIVE_STATES = new Set<CallState>([
  "connecting",
  "listening",
  "user-speaking",
  "hold-to-talk",
  "agent-thinking",
  "agent-speaking",
  "reconnecting",
  "finalizing",
]);

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function VoiceOrb({
  state,
  mode,
  agentName,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onRetry,
  audioLevelRef,
  nudging = false,
  nudgeKey = 0,
}: Props) {
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const cls = `voice-orb state-${state.callState}${
    nudging ? " is-nudging" : ""
  }`;
  const label = voiceStateLabel(state, mode, agentName);
  const helperText = subcopy(state.callState, mode, agentName);
  const levelLoopActive = LEVEL_ACTIVE_STATES.has(state.callState);

  useEffect(() => {
    const element = orbRef.current;
    if (!element) return;
    const motionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia(REDUCED_MOTION_QUERY)
        : null;

    let raf: number | null = null;
    let renderedLevel = Number.parseFloat(
      element.style.getPropertyValue("--orb-level") || "0",
    );
    const stop = () => {
      if (raf !== null) window.cancelAnimationFrame(raf);
      raf = null;
      if (audioLevelRef) audioLevelRef.current = 0;
      element.style.setProperty("--orb-level", "0");
    };
    const canRunLevelLoop = () =>
      levelLoopActive &&
      !motionQuery?.matches &&
      !(
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      );
    const tick = () => {
      if (!canRunLevelLoop()) {
        stop();
        return;
      }
      const targetLevel = Math.max(
        0,
        Math.min(1, audioLevelRef?.current ?? 0),
      );
      renderedLevel += (targetLevel - renderedLevel) * 0.28;
      if (audioLevelRef) audioLevelRef.current = targetLevel * 0.84;
      element.style.setProperty("--orb-level", renderedLevel.toFixed(3));
      raf = window.requestAnimationFrame(tick);
    };
    const handleVisibility = () => {
      if (!canRunLevelLoop()) {
        stop();
      } else if (raf === null) {
        raf = window.requestAnimationFrame(tick);
      }
    };
    const handleMotionPreference = () => handleVisibility();

    if (canRunLevelLoop()) raf = window.requestAnimationFrame(tick);
    else stop();
    document.addEventListener("visibilitychange", handleVisibility);
    motionQuery?.addEventListener?.("change", handleMotionPreference);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      motionQuery?.removeEventListener?.("change", handleMotionPreference);
      stop();
    };
  }, [audioLevelRef, levelLoopActive]);

  useLayoutEffect(() => {
    if (!nudging || nudgeKey <= 0) return;
    const element = orbRef.current;
    if (!element) return;
    element.style.animation = "none";
    void element.offsetWidth;
    element.style.animation = "";
  }, [nudgeKey, nudging]);

  return (
    <div className="orb-stage" aria-live="polite" aria-atomic="true">
      <button
        ref={orbRef}
        type="button"
        className={cls}
        data-nudge-key={nudging ? nudgeKey : undefined}
        aria-label={`Voice orb: ${label}`}
        aria-pressed={state.callState === "hold-to-talk"}
        aria-roledescription="voice orb"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
      >
        <span className="orb-aura" />
        <span className="orb-core" />
        <span className="orb-ring" />
        <span className="orb-shimmer" />
        <span className="orb-wave w1" />
        <span className="orb-wave w2" />
      </button>
      <h1 className="orb-agent-title">{agentName}</h1>
      <div className="state-copy">
        <p>{label}</p>
        {helperText ? <span>{helperText}</span> : null}
        {nudging ? (
          <span key={`nudge-copy-${nudgeKey}`} className="sr-only">
            Still finalizing.
          </span>
        ) : null}
        {state.callState === "error" ? (
          <button type="button" className="retry-pill" onClick={onRetry}>
            Tap to retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

function voiceStateLabel(
  state: VoiceState,
  mode: VoiceMode,
  agentName: string,
): string {
  if (mode === "live") return stateLabel(state, agentName);
  if (state.callState === "idle") return `Hold to talk to ${agentName}`;
  if (state.callState === "agent-thinking") return "Sending...";
  return stateLabel(state, agentName);
}

function subcopy(callState: CallState, mode: VoiceMode, agentName: string) {
  if (mode === "push-to-talk") {
    switch (callState) {
      case "idle":
        return "Hold, speak.";
      case "hold-to-talk":
        return "Release to send.";
      case "finalizing":
        return "Finalizing";
      case "agent-thinking":
        return `${agentName} is working.`;
      case "error":
        return "Retry voice.";
      default:
        return "";
    }
  }
  switch (callState) {
    case "hold-to-talk":
      return "Release to finish.";
    case "listening":
      return "Tap to pause.";
    case "paused":
      return `Tap the orb to resume ${agentName}.`;
    case "agent-speaking":
      return "Hold to interrupt.";
    case "agent-thinking":
      return "One moment.";
    case "reconnecting":
      return "Keeping voice alive.";
    case "error":
      return "Retry voice.";
    default:
      return "";
  }
}
