export interface ReplyAudioController {
  unlock(): Promise<boolean>;
  playDataUrl(
    dataUrl: string,
    onEnded?: () => void,
    shouldPlay?: () => boolean,
  ): Promise<boolean>;
  stop(): void;
  close(): void;
}

export interface ReplyAudioControllerOptions {
  AudioContextCtor?: typeof AudioContext;
}

type AudioContextStateLike = AudioContextState | "interrupted";

type AudioSessionType = "auto" | "playback" | "play-and-record" | "ambient";

// iOS Safari (16.4+) silences Web Audio when the ring/silent switch is on
// UNLESS the page declares a "playback" audio session — the same mechanism
// ChatGPT and other voice apps use to speak through silent mode. We scope it
// to the actual reply playback and release it afterward so a later hold can
// still record. Feature-detected: a no-op everywhere the API is absent.
function setAudioSession(type: AudioSessionType): void {
  try {
    const nav = navigator as Navigator & {
      audioSession?: { type: string };
    };
    if (nav.audioSession && typeof nav.audioSession.type === "string") {
      nav.audioSession.type = type;
    }
  } catch {
    // Unsupported browser — ignore.
  }
}

function defaultAudioContextCtor(): typeof AudioContext | undefined {
  return (
    globalThis.AudioContext ??
    (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

export function createReplyAudioController(
  options: ReplyAudioControllerOptions = {},
): ReplyAudioController {
  const AudioContextCtor = options.AudioContextCtor ?? defaultAudioContextCtor();
  let context: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let unlocking: Promise<boolean> | null = null;

  async function ensureContext(): Promise<AudioContext | null> {
    if (!AudioContextCtor) return null;
    if (!context) {
      try {
        context = new AudioContextCtor();
      } catch {
        context = null;
        return null;
      }
    }
    const state = context.state as AudioContextStateLike;
    if (state === "suspended" || state === "interrupted") {
      try {
        await context.resume();
      } catch {
        return null;
      }
    }
    // If iOS could not re-activate the context (e.g. suspended outside a user
    // gesture), report failure so the caller can fall back rather than "play"
    // into a dead context that produces no sound.
    if ((context.state as AudioContextStateLike) !== "running") return null;
    return context;
  }

  async function unlock(): Promise<boolean> {
    if (unlocking) return unlocking;
    unlocking = ensureContext()
      .then((nextContext) => Boolean(nextContext))
      .finally(() => {
        unlocking = null;
      });
    return unlocking;
  }

  function stop(): void {
    const activeSource = source;
    source = null;
    // Release the playback session so a subsequent hold can record.
    setAudioSession("auto");
    if (!activeSource) return;
    try {
      activeSource.onended = null;
      activeSource.stop();
    } catch {
      // Already stopped.
    }
  }

  async function playDataUrl(
    dataUrl: string,
    onEnded?: () => void,
    shouldPlay?: () => boolean,
  ): Promise<boolean> {
    // Declare a playback session up front so the resume + decode + start all
    // run under it (iOS routes the audio through the silent switch). Reset to
    // "auto" on every non-playing exit so a later hold can still record.
    setAudioSession("playback");
    const nextContext = await ensureContext();
    if (!nextContext) {
      setAudioSession("auto");
      return false;
    }
    if (shouldPlay && !shouldPlay()) {
      setAudioSession("auto");
      return false;
    }
    stop();
    setAudioSession("playback"); // stop() reset it; we are about to play.
    let attemptSource: AudioBufferSourceNode | null = null;
    try {
      const response = await fetch(dataUrl);
      const audioData = await response.arrayBuffer();
      if (shouldPlay && !shouldPlay()) {
        setAudioSession("auto");
        return false;
      }
      const buffer = await nextContext.decodeAudioData(audioData.slice(0));
      if (shouldPlay && !shouldPlay()) {
        setAudioSession("auto");
        return false;
      }
      const nextSource = nextContext.createBufferSource();
      attemptSource = nextSource;
      nextSource.buffer = buffer;
      nextSource.connect(nextContext.destination);
      source = nextSource;
      if (shouldPlay && !shouldPlay()) {
        source = null;
        setAudioSession("auto");
        return false;
      }
      nextSource.onended = () => {
        setAudioSession("auto");
        if (source === nextSource) source = null;
        onEnded?.();
      };
      nextSource.start();
      return true;
    } catch {
      setAudioSession("auto");
      if (attemptSource && source === attemptSource) {
        source = null;
        try {
          attemptSource.onended = null;
          attemptSource.stop();
        } catch {
          // Already stopped.
        }
      }
      return false;
    }
  }

  function close(): void {
    stop();
    void context?.close().catch(() => undefined);
    context = null;
  }

  return { unlock, playDataUrl, stop, close };
}
