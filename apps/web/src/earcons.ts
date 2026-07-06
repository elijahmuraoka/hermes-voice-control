export type EarconName = "send" | "reply" | "session-start" | "session-end";

export interface EarconController {
  unlock(): Promise<void>;
  play(name: EarconName): void;
  close(): void;
}

export interface EarconControllerOptions {
  AudioContextCtor?: typeof AudioContext;
}

const PENDING_EARCON_MAX_AGE_MS = 750;

type ToneStep = {
  frequency: number;
  start: number;
  duration: number;
  gain: number;
};

const EARCONS: Record<EarconName, ToneStep[]> = {
  send: [
    { frequency: 523.25, start: 0, duration: 0.055, gain: 0.035 },
    { frequency: 659.25, start: 0.062, duration: 0.06, gain: 0.032 },
  ],
  reply: [{ frequency: 783.99, start: 0, duration: 0.14, gain: 0.032 }],
  "session-start": [
    { frequency: 392, start: 0, duration: 0.075, gain: 0.025 },
    { frequency: 523.25, start: 0.085, duration: 0.095, gain: 0.028 },
  ],
  "session-end": [{ frequency: 349.23, start: 0, duration: 0.13, gain: 0.025 }],
};

export function createEarconController(
  options: EarconControllerOptions = {},
): EarconController {
  const AudioContextCtor = options.AudioContextCtor ?? globalThis.AudioContext;
  let context: AudioContext | null = null;
  let unlocked = false;
  let unlocking: Promise<void> | null = null;
  let pendingEarcon: { name: EarconName; queuedAt: number } | null = null;

  function playNow(name: EarconName) {
    if (!context) return;
    const startAt = context.currentTime;
    for (const tone of EARCONS[name]) scheduleTone(context, startAt, tone);
  }

  function flushPendingEarcon() {
    if (!pendingEarcon) return;
    const pending = pendingEarcon;
    pendingEarcon = null;
    if (Date.now() - pending.queuedAt > PENDING_EARCON_MAX_AGE_MS) return;
    playNow(pending.name);
  }

  function unlock(): Promise<void> {
    if (unlocking) return unlocking;
    if (!AudioContextCtor) return Promise.resolve();
    unlocking = (async () => {
      try {
        context ??= new AudioContextCtor();
      } catch {
        context = null;
        unlocked = false;
        return;
      }
      if (context.state === "suspended") {
        try {
          await context.resume();
        } catch {
          pendingEarcon = null;
          unlocked = false;
          return;
        }
      }
      unlocked = true;
      flushPendingEarcon();
    })().finally(() => {
      unlocking = null;
    });
    return unlocking;
  }

  function play(name: EarconName) {
    if (!context) return;
    if (context.state === "suspended") {
      pendingEarcon = { name, queuedAt: Date.now() };
      void unlock();
      return;
    }
    if (!unlocked) {
      if (unlocking) pendingEarcon = { name, queuedAt: Date.now() };
      return;
    }
    playNow(name);
  }

  function close() {
    unlocked = false;
    pendingEarcon = null;
    void context?.close().catch(() => undefined);
    context = null;
  }

  return { unlock, play, close };
}

function scheduleTone(
  context: AudioContext,
  startAt: number,
  tone: ToneStep,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = startAt + tone.start;
  const end = start + tone.duration;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(tone.frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(end + 0.018);
}
