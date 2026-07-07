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
    const nextContext = await ensureContext();
    if (!nextContext) return false;
    if (shouldPlay && !shouldPlay()) return false;
    stop();
    let attemptSource: AudioBufferSourceNode | null = null;
    try {
      const response = await fetch(dataUrl);
      const audioData = await response.arrayBuffer();
      if (shouldPlay && !shouldPlay()) return false;
      const buffer = await nextContext.decodeAudioData(audioData.slice(0));
      if (shouldPlay && !shouldPlay()) return false;
      const nextSource = nextContext.createBufferSource();
      attemptSource = nextSource;
      nextSource.buffer = buffer;
      nextSource.connect(nextContext.destination);
      nextSource.onended = () => {
        if (source === nextSource) source = null;
        onEnded?.();
      };
      source = nextSource;
      if (shouldPlay && !shouldPlay()) {
        source = null;
        return false;
      }
      nextSource.start();
      return true;
    } catch {
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
