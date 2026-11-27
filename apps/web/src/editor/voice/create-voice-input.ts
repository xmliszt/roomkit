import type { SpeechRecognizer } from "./speech-recognizer.ts";
import type { VoiceInputError, VoiceInputState } from "./voice-input-state.ts";

type Session = {
  recognizer: SpeechRecognizer;
  isStarted: boolean;
  isStopping: boolean;
  isHeard: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
};

function getVoiceInputError(code: string): VoiceInputError {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission-denied";
    case "audio-capture":
      return "no-microphone";
    case "network":
      return "network";
    case "no-speech":
      return "no-speech";
    case "language-not-supported":
      return "language-not-supported";
    default:
      return "failed";
  }
}

/** Return a controller that runs one speech recognizer at a time, reports its state through `onState` and, while listening, the whole dictated text so far, its results joined by `separator`, through `onText`. */
export function createVoiceInput(options: {
  Recognizer: (new () => SpeechRecognizer) | undefined;
  lang: string;
  separator: string;
  silenceMs: number;
  stopGraceMs: number;
  onState: (state: VoiceInputState) => void;
  onText: (text: string) => void;
}) {
  let state: VoiceInputState = options.Recognizer
    ? { kind: "idle" }
    : { kind: "unavailable" };
  let session: Session | undefined;

  function setState(next: VoiceInputState) {
    state = next;
    options.onState(next);
  }

  function finish(finished: { current: Session; next: VoiceInputState }) {
    const { current, next } = finished;
    if (session !== current) return;
    session = undefined;
    clearTimeout(current.timer);
    current.recognizer.onstart = null;
    current.recognizer.onaudiostart = null;
    current.recognizer.onresult = null;
    current.recognizer.onerror = null;
    current.recognizer.onend = null;
    current.recognizer.abort();
    if (state.kind !== next.kind || next.kind === "error") setState(next);
  }

  function stop() {
    const current = session;
    if (current === undefined || current.isStopping) return;
    if (!current.isStarted) {
      finish({ current, next: { kind: "idle" } });
      return;
    }
    current.isStopping = true;
    clearTimeout(current.timer);
    current.timer = setTimeout(
      () => finish({ current, next: { kind: "idle" } }),
      options.stopGraceMs,
    );
    current.recognizer.stop();
    setState({ kind: "idle" });
  }

  function armSilenceTimer(current: Session) {
    clearTimeout(current.timer);
    current.timer = setTimeout(() => {
      if (current.isHeard) stop();
      else finish({ current, next: { kind: "error", error: "no-speech" } });
    }, options.silenceMs);
  }

  function markStarted(current: Session) {
    if (session !== current || current.isStopping || current.isStarted) return;
    current.isStarted = true;
    armSilenceTimer(current);
  }

  function start() {
    if (options.Recognizer === undefined) return;
    if (session !== undefined && !session.isStopping) return;
    if (session !== undefined)
      finish({ current: session, next: { kind: "idle" } });
    const recognizer = new options.Recognizer();
    recognizer.lang = options.lang;
    recognizer.continuous = true;
    recognizer.interimResults = true;
    const current: Session = {
      recognizer,
      isStarted: false,
      isStopping: false,
      isHeard: false,
      timer: undefined,
    };
    recognizer.onstart = () => markStarted(current);
    recognizer.onaudiostart = () => markStarted(current);
    recognizer.onresult = (event) => {
      if (session !== current || current.isStopping) return;
      current.isStarted = true;
      const text = Array.from(
        event.results,
        (result) => result[0]?.transcript.trim() ?? "",
      )
        .filter((transcript) => transcript !== "")
        .join(options.separator);
      if (text !== "") current.isHeard = true;
      armSilenceTimer(current);
      options.onText(text);
    };
    recognizer.onerror = (event) => {
      finish({
        current,
        next:
          event.error === "aborted" || current.isStopping
            ? { kind: "idle" }
            : { kind: "error", error: getVoiceInputError(event.error) },
      });
    };
    recognizer.onend = () => finish({ current, next: { kind: "idle" } });
    session = current;
    setState({ kind: "listening" });
    try {
      recognizer.start();
    } catch {
      finish({ current, next: { kind: "error", error: "failed" } });
    }
  }

  function cancel() {
    if (session !== undefined)
      finish({ current: session, next: { kind: "idle" } });
    else if (state.kind === "error") setState({ kind: "idle" });
  }

  return {
    getState: () => state,
    start,
    stop,
    cancel,
  };
}
