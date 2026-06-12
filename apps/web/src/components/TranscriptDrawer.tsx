import { MessageCircle, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DrawerState, TranscriptEntry } from "../types";
interface Props {
  drawer: DrawerState;
  entries: TranscriptEntry[];
  agentName: string;
  agentNoun: string;
  onToggle: () => void;
  onSubmit: (text: string) => Promise<void> | void;
  onFocus: () => void;
  onBlur: () => void;
}

function statusLabel(status: TranscriptEntry["status"]) {
  if (status === "streaming") return "live";
  if (status === "complete") return "";
  return status;
}

export function TranscriptDrawer({
  drawer,
  entries,
  agentName,
  agentNoun,
  onToggle,
  onSubmit,
  onFocus,
  onBlur,
}: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const latestEntry = entries.at(-1);
  const transcriptKey = useMemo(
    () => entries.map((entry) => `${entry.id}:${entry.status}:${entry.text}`).join("|"),
    [entries],
  );

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (typeof body.scrollTo === "function") {
      body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
    } else {
      body.scrollTop = body.scrollHeight;
    }
  }, [transcriptKey]);

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
    <aside
      className={`transcript drawer-${drawer}`}
      aria-label="Conversation transcript"
    >
      <button
        type="button"
        className="drawer-tab"
        onClick={onToggle}
        aria-label="Toggle transcript"
      >
        <MessageCircle size={18} />
        <span>Transcript</span>
        {drawer === "open" ? <X size={16} /> : null}
      </button>
      <div className="transcript-body" ref={bodyRef} aria-live="polite">
        {entries.length === 0 ? (
          <div className="empty-transcript">
            <p>Quiet for now.</p>
          </div>
        ) : (
          entries.map((e) => (
            <article
              key={e.id}
              className={`message role-${e.role} status-${e.status}`}
            >
              <div className="message-meta">
                <span>
                  {e.role === "agent"
                    ? agentName
                    : e.role === "user"
                      ? "You"
                      : "System"}
                </span>
                {statusLabel(e.status) ? (
                  <span className={e.status === "streaming" ? "live-meta" : ""}>
                    {statusLabel(e.status)}
                  </span>
                ) : null}
              </div>
              <p>{e.text}</p>
            </article>
          ))
        )}
      </div>
      <form
        className="transcript-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {latestEntry?.role === "user" && latestEntry.status === "streaming" ? (
          <div className="live-transcript" aria-label="Live transcript">
            <span />
            <p>{latestEntry.text}</p>
          </div>
        ) : null}
        <div className="composer-row">
          <input
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder={`Message ${agentNoun}...`}
            aria-label={`Type a message to ${agentNoun}`}
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Send typed message"
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </aside>
  );
}
