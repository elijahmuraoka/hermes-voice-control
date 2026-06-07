import type { CallState } from "../types";
import { stateLabel } from "../stateMachine";
import type { VoiceState } from "../types";
interface Props {
  state: VoiceState;
  agentName: string;
  onPointerDown: React.PointerEventHandler<HTMLButtonElement>;
  onPointerUp: React.PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: React.PointerEventHandler<HTMLButtonElement>;
}
export function VoiceOrb({
  state,
  agentName,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
}: Props) {
  const cls = `voice-orb state-${state.callState}`;
  return (
    <div className="orb-stage" aria-live="polite">
      <button
        type="button"
        className={cls}
        aria-label={`Voice orb: ${stateLabel(state, agentName)}`}
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
        <p>{stateLabel(state, agentName)}</p>
        <span>{subcopy(state.callState, agentName)}</span>
      </div>
    </div>
  );
}
function subcopy(callState: CallState, agentName: string) {
  switch (callState) {
    case "hold-to-talk":
      return "Release to finish the turn.";
    case "listening":
      return "Tap to pause. Hold for a longer thought.";
    case "paused":
      return `Tap the orb to resume ${agentName}.`;
    case "agent-speaking":
      return "Hold the orb to barge in.";
    case "error":
      return "Open transcript for recovery details.";
    default:
      return "Private local control surface.";
  }
}
