import launchBudgets from "./diagnosticsBudgets.json";

export const HVC_DIAGNOSTICS_VERSION = 1;
export const HVC_LAUNCH_BUDGETS = launchBudgets;

export type HvcDiagnosticsEventName =
  | "session_start"
  | "session_resume"
  | "mic_start"
  | "provider_response_first"
  | "audio_playback_first"
  | "tool_call_request"
  | "tool_call_response"
  | "tool_call_cancellation"
  | "session_close"
  | "session_error";

export type HvcDiagnosticsValue =
  | string
  | number
  | boolean
  | readonly (string | number)[];

export type HvcDiagnosticsDetail = Partial<
  Record<string, HvcDiagnosticsValue>
>;

export interface HvcDiagnosticsEvent {
  name: HvcDiagnosticsEventName;
  epochMs: number;
  monotonicMs: number;
  detail?: HvcDiagnosticsDetail;
}

export interface HvcToolCallMetric {
  toolCallSeq: number;
  toolName?: string;
  requestAtMs?: number;
  responseAtMs?: number;
  latencyMs?: number;
  cancelledAtMs?: number;
}

export interface HvcDiagnosticsSummary {
  firstProviderResponseLatencyMs?: number;
  firstAudioPlaybackLatencyMs?: number;
  resumeLatencyMs?: number;
  sessionClosedAtMs?: number;
  cancellationCount: number;
  toolCalls: HvcToolCallMetric[];
}

export interface HvcDiagnosticsSnapshot {
  version: typeof HVC_DIAGNOSTICS_VERSION;
  capturedAt: string;
  privacy: {
    localOnly: true;
    redacted: true;
    note: string;
  };
  budgets: typeof HVC_LAUNCH_BUDGETS;
  summary: HvcDiagnosticsSummary;
  events: HvcDiagnosticsEvent[];
}

export interface HvcDiagnosticsRecorder {
  startSession(): void;
  mark(name: HvcDiagnosticsEventName, detail?: HvcDiagnosticsDetail): void;
  record(event: HvcDiagnosticsEvent): void;
  snapshot(): HvcDiagnosticsSnapshot;
  copyText(): string;
  redactText(value: string): string;
}

export interface HvcDiagnosticsWindowApi {
  snapshot(): HvcDiagnosticsSnapshot;
  copyText(): string;
  redactText(value: string): string;
}

declare global {
  interface Window {
    __HVC_DIAGNOSTICS__?: HvcDiagnosticsWindowApi;
  }
}

const MAX_EVENTS = 200;
const SECRET_KEY_PATTERN =
  /\b((?:api[_-]?key|authorization|bearer|cookie|password|pin|secret|session[_-]?(?:id|key)?|sessionid|sessionkey|sid|(?:[a-z0-9]+[_-]?)?token)\s*[=:]\s*)("[^"]*"|'[^']*'|[^&\s,;]+)/gi;
const JSON_SECRET_KEY_PATTERN =
  /("(?:(?:api[_-]?key|authorization|bearer|cookie|password|pin|secret|session[_-]?(?:id|key)?|sessionid|sessionkey|sid|(?:[a-z0-9]+[_-]?)?token))"\s*:\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi;
const SECRET_DETAIL_KEY_PATTERN =
  /(?:api[_-]?key|authorization|bearer|cookie|password|pin|secret|session[_-]?(?:id|key)?|sessionid|sessionkey|sid|(?:[a-z0-9]+[_-]?)?token)/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const SESSION_PATH_PATTERN =
  /\b(session(?:s)?\/)[A-Za-z0-9._~-]{8,}/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export function createHvcDiagnosticsEvent(
  name: HvcDiagnosticsEventName,
  detail?: HvcDiagnosticsDetail,
): HvcDiagnosticsEvent {
  return {
    name,
    epochMs: Date.now(),
    monotonicMs: nowMs(),
    ...(detail ? { detail: sanitizeDiagnosticsDetail(detail) } : {}),
  };
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(JSON_SECRET_KEY_PATTERN, "$1[redacted]")
    .replace(SECRET_KEY_PATTERN, "$1[redacted]")
    .replace(SESSION_PATH_PATTERN, "$1[redacted]")
    .replace(JWT_PATTERN, "[redacted-jwt]");
}

export function createHvcDiagnosticsRecorder(): HvcDiagnosticsRecorder {
  let events: HvcDiagnosticsEvent[] = [];

  function record(event: HvcDiagnosticsEvent): void {
    events = [...events, sanitizeDiagnosticsEvent(event)].slice(-MAX_EVENTS);
  }

  function snapshot(): HvcDiagnosticsSnapshot {
    return {
      version: HVC_DIAGNOSTICS_VERSION,
      capturedAt: new Date().toISOString(),
      privacy: {
        localOnly: true,
        redacted: true,
        note: "Diagnostics stay in browser memory and omit tokens, secrets, session ids, tool args, and response bodies.",
      },
      budgets: HVC_LAUNCH_BUDGETS,
      summary: summarizeDiagnostics(events),
      events: [...events],
    };
  }

  return {
    startSession() {
      events = [];
      record(createHvcDiagnosticsEvent("session_start"));
    },
    mark(name, detail) {
      record(createHvcDiagnosticsEvent(name, detail));
    },
    record,
    snapshot,
    copyText() {
      return JSON.stringify(snapshot(), null, 2);
    },
    redactText: redactDiagnosticText,
  };
}

export function exposeHvcDiagnostics(
  recorder: HvcDiagnosticsRecorder | null,
): void {
  if (typeof window === "undefined") return;
  if (!recorder) {
    delete window.__HVC_DIAGNOSTICS__;
    return;
  }
  window.__HVC_DIAGNOSTICS__ = {
    snapshot: () => recorder.snapshot(),
    copyText: () => recorder.copyText(),
    redactText: redactDiagnosticText,
  };
}

export function summarizeDiagnostics(
  events: readonly HvcDiagnosticsEvent[],
): HvcDiagnosticsSummary {
  const sessionStart = firstEvent(events, "session_start");
  const firstProvider = firstEvent(events, "provider_response_first");
  const firstAudio = firstEvent(events, "audio_playback_first");
  const firstResume = firstEvent(events, "session_resume");
  const firstProviderAfterResume = firstResume
    ? firstEventAfter(events, "provider_response_first", firstResume.monotonicMs)
    : undefined;
  const sessionClose = lastEvent(events, "session_close");
  const toolCalls = summarizeToolCalls(events);

  return {
    firstProviderResponseLatencyMs: latency(sessionStart, firstProvider),
    firstAudioPlaybackLatencyMs: latency(sessionStart, firstAudio),
    resumeLatencyMs: latency(firstResume, firstProviderAfterResume),
    sessionClosedAtMs: latency(sessionStart, sessionClose),
    cancellationCount: cancellationCount(events),
    toolCalls,
  };
}

function summarizeToolCalls(
  events: readonly HvcDiagnosticsEvent[],
): HvcToolCallMetric[] {
  const calls = new Map<number, HvcToolCallMetric>();
  for (const event of events) {
    const seqs = toolCallSeqs(event);
    if (seqs.length === 0) continue;
    for (const seq of seqs) {
      const current = calls.get(seq) ?? { toolCallSeq: seq };
      const toolName = stringDetail(event, "toolName");
      if (toolName) current.toolName = toolName;
      if (event.name === "tool_call_request") {
        current.requestAtMs = event.monotonicMs;
      }
      if (event.name === "tool_call_response") {
        current.responseAtMs = event.monotonicMs;
        current.latencyMs =
          current.requestAtMs === undefined
            ? undefined
            : roundMs(event.monotonicMs - current.requestAtMs);
      }
      if (event.name === "tool_call_cancellation") {
        current.cancelledAtMs = event.monotonicMs;
      }
      calls.set(seq, current);
    }
  }
  return [...calls.values()];
}

function cancellationCount(events: readonly HvcDiagnosticsEvent[]): number {
  return events.reduce((total, event) => {
    if (event.name !== "tool_call_cancellation") return total;
    return total + (numericDetail(event, "count") ?? 1);
  }, 0);
}

function sanitizeDiagnosticsEvent(
  event: HvcDiagnosticsEvent,
): HvcDiagnosticsEvent {
  return {
    name: event.name,
    epochMs: event.epochMs,
    monotonicMs: event.monotonicMs,
    ...(event.detail ? { detail: sanitizeDiagnosticsDetail(event.detail) } : {}),
  };
}

function sanitizeDiagnosticsDetail(
  detail: HvcDiagnosticsDetail,
): HvcDiagnosticsDetail {
  const sanitized: HvcDiagnosticsDetail = {};
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined) continue;
    if (isSensitiveDetailKey(key)) {
      sanitized[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string") {
      sanitized[key] = redactDiagnosticText(value).slice(0, 160);
    } else if (Array.isArray(value)) {
      sanitized[key] = value
        .filter((item): item is string | number =>
          typeof item === "string" || typeof item === "number",
        )
        .map((item) =>
          typeof item === "string"
            ? redactDiagnosticText(item).slice(0, 160)
            : item,
        );
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function isSensitiveDetailKey(key: string): boolean {
  return SECRET_DETAIL_KEY_PATTERN.test(key);
}

function firstEvent(
  events: readonly HvcDiagnosticsEvent[],
  name: HvcDiagnosticsEventName,
): HvcDiagnosticsEvent | undefined {
  return events.find((event) => event.name === name);
}

function lastEvent(
  events: readonly HvcDiagnosticsEvent[],
  name: HvcDiagnosticsEventName,
): HvcDiagnosticsEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].name === name) return events[index];
  }
  return undefined;
}

function firstEventAfter(
  events: readonly HvcDiagnosticsEvent[],
  name: HvcDiagnosticsEventName,
  monotonicMs: number,
): HvcDiagnosticsEvent | undefined {
  return events.find(
    (event) => event.name === name && event.monotonicMs >= monotonicMs,
  );
}

function latency(
  start: HvcDiagnosticsEvent | undefined,
  end: HvcDiagnosticsEvent | undefined,
): number | undefined {
  if (!start || !end) return undefined;
  return roundMs(end.monotonicMs - start.monotonicMs);
}

function numericDetail(
  event: HvcDiagnosticsEvent,
  key: string,
): number | undefined {
  const value = event.detail?.[key];
  return typeof value === "number" ? value : undefined;
}

function numericArrayDetail(
  event: HvcDiagnosticsEvent,
  key: string,
): number[] {
  const value = event.detail?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

function toolCallSeqs(event: HvcDiagnosticsEvent): number[] {
  const single = numericDetail(event, "toolCallSeq");
  const many = numericArrayDetail(event, "toolCallSeqs");
  const seqs = single === undefined ? many : [single, ...many];
  return [...new Set(seqs)];
}

function stringDetail(
  event: HvcDiagnosticsEvent,
  key: string,
): string | undefined {
  const value = event.detail?.[key];
  return typeof value === "string" ? value : undefined;
}

function roundMs(value: number): number {
  return Math.max(0, Math.round(value));
}

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
