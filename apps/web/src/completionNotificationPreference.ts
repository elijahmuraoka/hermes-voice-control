const STORAGE_KEY = "hvc.spokenCompletionNotifications.v1";

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readSpokenCompletionNotificationsEnabled(): boolean {
  const storage = getLocalStorage();
  if (!storage) return true;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === "disabled") return false;
    if (raw === "enabled") return true;
    return true;
  } catch {
    return true;
  }
}

export function saveSpokenCompletionNotificationsEnabled(
  enabled: boolean,
): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, enabled ? "enabled" : "disabled");
  } catch {
    // Preference persistence is optional; chat and voice should keep working.
  }
}
