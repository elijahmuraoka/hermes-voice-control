import { Send } from "lucide-react";
import { useState } from "react";
interface Props {
  disabled?: boolean;
  agentNoun: string;
  onSubmit: (text: string) => Promise<void> | void;
  onFocus: () => void;
  onBlur: () => void;
}
export function FloatingChat({
  disabled,
  agentNoun,
  onSubmit,
  onFocus,
  onBlur,
}: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onSubmit(text);
      setDraft("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="floating-chat"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={`Type to ${agentNoun}...`}
        aria-label={`Type a message to ${agentNoun}`}
        disabled={disabled || busy}
      />
      <button
        type="submit"
        disabled={disabled || busy || !draft.trim()}
        aria-label="Send typed message"
      >
        <Send size={18} />
      </button>
    </form>
  );
}
