export interface BrowserSpeechRecognitionAlternative {
  transcript: string;
  confidence?: number;
}

export interface BrowserSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): BrowserSpeechRecognitionAlternative;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

export interface BrowserSpeechRecognitionResultList {
  readonly length: number;
  item(index: number): BrowserSpeechRecognitionResult;
  [index: number]: BrowserSpeechRecognitionResult;
}

export interface BrowserSpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: BrowserSpeechRecognitionResultList;
}

export interface BrowserSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}

export interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type BrowserSpeechRecognitionConstructor =
  new () => BrowserSpeechRecognition;

type SpeechRecognitionWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };

export interface SpeechRecognitionTranscript {
  finalText: string;
  interimText: string;
}

export function getSpeechRecognitionConstructor(
  win: SpeechRecognitionWindow | undefined = typeof window === "undefined"
    ? undefined
    : (window as SpeechRecognitionWindow),
): BrowserSpeechRecognitionConstructor | null {
  return win?.SpeechRecognition ?? win?.webkitSpeechRecognition ?? null;
}

export function browserSupportsSpeechRecognition(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

export function createSpeechRecognition(): BrowserSpeechRecognition | null {
  const Constructor = getSpeechRecognitionConstructor();
  return Constructor ? new Constructor() : null;
}

export function readSpeechRecognitionTranscript(
  event: BrowserSpeechRecognitionEvent,
): SpeechRecognitionTranscript {
  const finalParts: string[] = [];
  const interimParts: string[] = [];

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index] ?? event.results.item(index);
    const alternative = result[0] ?? result.item(0);
    const transcript = alternative?.transcript?.trim();
    if (!transcript) continue;
    if (result.isFinal) finalParts.push(transcript);
    else interimParts.push(transcript);
  }

  return {
    finalText: finalParts.join(" ").trim(),
    interimText: interimParts.join(" ").trim(),
  };
}
