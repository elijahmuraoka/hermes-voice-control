import { MessageCircle, X } from "lucide-react";
import type { DrawerState, TranscriptEntry } from "../types";
interface Props {
  drawer: DrawerState;
  entries: TranscriptEntry[];
  onToggle: () => void;
}
export function TranscriptDrawer({ drawer, entries, onToggle }: Props) {
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
      <div className="transcript-body">
        {entries.length === 0 ? (
          <div className="empty-transcript">
            <p>Your conversation will appear here.</p>
            <span>
              Voice, typed notes, retries, and confirmations stay visible
              without ending the call.
            </span>
          </div>
        ) : (
          entries.map((e) => (
            <article key={e.id} className={`message role-${e.role}`}>
              <div className="message-meta">
                <span>
                  {e.role === "bob"
                    ? "Bob"
                    : e.role === "user"
                      ? "You"
                      : "System"}
                </span>
                <span>{e.status}</span>
              </div>
              <p>{e.text}</p>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
