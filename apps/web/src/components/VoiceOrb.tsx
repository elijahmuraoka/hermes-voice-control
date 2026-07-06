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
  nudging?: boolean;
}
export function VoiceOrb({
  state,
  mode,
  agentName,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onRetry,
  nudging = false,
}: Props) {
  const cls = `voice-orb state-${state.callState}${nudging ? " is-nudging" : ""}`;
  const label = voiceStateLabel(state, mode, agentName);
  const helperText = subcopy(state.callState, mode, agentName);
  return (
    <div className="orb-stage" aria-live="polite">
      <button
        type="button"
        className={cls}
        aria-label={`Voice orb: ${label}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
      >
        <span className="orb-aura" />
        <span className="orb-core" />
        <span className="orb-ring" />
        <span className="orb-wave w1" />
        <span className="orb-wave w2" />
      </button>
      <div className="state-copy">
        <p>{label}</p>
        {helperText ? <span>{helperText}</span> : null}
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
