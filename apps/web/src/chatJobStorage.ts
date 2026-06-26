const STORAGE_KEY = "hvc.pendingTextJobs.v1";
const PENDING_JOB_TTL_MS = 2 * 60 * 60 * 1000;

export interface PendingTextJob {
  jobId: string;
  savedAt: number;
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isPendingTextJob(value: unknown): value is PendingTextJob {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.jobId === "string" &&
    item.jobId.length > 0 &&
    item.jobId.length <= 240 &&
    typeof item.savedAt === "number" &&
    Number.isFinite(item.savedAt)
  );
}

function pruneExpired(items: PendingTextJob[], now: number): PendingTextJob[] {
  return items.filter((item) => now - item.savedAt <= PENDING_JOB_TTL_MS);
}

function writePendingTextJobs(items: PendingTextJob[]): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Losing refresh recovery is better than risking user-visible chat failure.
  }
}

export function readPendingTextJobs(now = Date.now()): PendingTextJob[] {
  const storage = getSessionStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = pruneExpired(parsed.filter(isPendingTextJob), now);
    if (valid.length !== parsed.length) writePendingTextJobs(valid);
    return valid;
  } catch {
    writePendingTextJobs([]);
    return [];
  }
}

export function savePendingTextJob(jobId: string, now = Date.now()): void {
  const existing = readPendingTextJobs(now).filter((item) => item.jobId !== jobId);
  writePendingTextJobs([...existing, { jobId, savedAt: now }]);
}

export function removePendingTextJob(jobId: string, now = Date.now()): void {
  writePendingTextJobs(
    readPendingTextJobs(now).filter((item) => item.jobId !== jobId),
  );
}
