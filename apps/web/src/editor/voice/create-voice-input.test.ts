import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceInput } from "./create-voice-input.ts";
import type { SpeechRecognizer } from "./speech-recognizer.ts";
import type { VoiceInputState } from "./voice-input-state.ts";

class FakeRecognizer implements SpeechRecognizer {
  static instances: FakeRecognizer[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: SpeechRecognizer["onstart"] = null;
  onaudiostart: SpeechRecognizer["onaudiostart"] = null;
  onresult: SpeechRecognizer["onresult"] = null;
  onerror: SpeechRecognizer["onerror"] = null;
  onend: SpeechRecognizer["onend"] = null;
  calls: string[] = [];
  constructor() {
    FakeRecognizer.instances.push(this);
  }
  start() {
    this.calls.push("start");
  }
  stop() {
    this.calls.push("stop");
  }
  abort() {
    this.calls.push("abort");
  }
  emit(results: { transcript: string; isFinal: boolean }[]) {
    this.onresult?.({
      results: results.map((result) =>
        Object.assign([{ transcript: result.transcript }], {
          isFinal: result.isFinal,
        }),
      ),
    });
  }
}

function buildVoiceInput(options: {
  Recognizer?: (new () => SpeechRecognizer) | undefined;
  separator?: string;
}) {
  const states: VoiceInputState[] = [];
  const texts: string[] = [];
  const voice = createVoiceInput({
    Recognizer: "Recognizer" in options ? options.Recognizer : FakeRecognizer,
    lang: "en-GB",
    separator: options.separator ?? " ",
    silenceMs: 5000,
    stopGraceMs: 1500,
    onState: (state) => states.push(state),
    onText: (text) => texts.push(text),
  });
  return { voice, states, texts };
}

function lastRecognizer() {
  const recognizer = FakeRecognizer.instances.at(-1);
  if (recognizer === undefined) throw new Error("no recognizer started");
  return recognizer;
}

function startListening(voice: ReturnType<typeof createVoiceInput>) {
  voice.start();
  const recognizer = lastRecognizer();
  recognizer.onstart?.();
  return recognizer;
}

describe("createVoiceInput", () => {
  beforeEach(() => {
    FakeRecognizer.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is unavailable without a recognizer and ignores start", () => {
    const { voice, states } = buildVoiceInput({ Recognizer: undefined });
    expect(voice.getState()).toEqual({ kind: "unavailable" });
    voice.start();
    expect(states).toEqual([]);
  });

  it("starts a continuous interim recognizer in the given language", () => {
    const { voice } = buildVoiceInput({});
    expect(voice.getState()).toEqual({ kind: "idle" });
    voice.start();
    const recognizer = lastRecognizer();
    expect(voice.getState()).toEqual({ kind: "listening" });
    expect(recognizer.lang).toBe("en-GB");
    expect(recognizer.continuous).toBe(true);
    expect(recognizer.interimResults).toBe(true);
    expect(recognizer.calls).toEqual(["start"]);
    voice.start();
    expect(FakeRecognizer.instances).toHaveLength(1);
  });

  it("reports interim text, then final text that replaces it", () => {
    const { voice, texts } = buildVoiceInput({});
    voice.start();
    const recognizer = lastRecognizer();
    recognizer.emit([{ transcript: "a sofa", isFinal: false }]);
    recognizer.emit([{ transcript: "a sofa by the", isFinal: false }]);
    recognizer.emit([{ transcript: "a sofa by the window", isFinal: true }]);
    recognizer.emit([
      { transcript: "a sofa by the window", isFinal: true },
      { transcript: " in green", isFinal: false },
    ]);
    expect(texts).toEqual([
      "a sofa",
      "a sofa by the",
      "a sofa by the window",
      "a sofa by the window in green",
    ]);
    expect(voice.getState()).toEqual({ kind: "listening" });
  });

  it("stops quietly after the silence timeout once speech was heard", () => {
    const { voice } = buildVoiceInput({});
    const recognizer = startListening(voice);
    vi.advanceTimersByTime(4000);
    recognizer.emit([{ transcript: "lamp", isFinal: true }]);
    vi.advanceTimersByTime(4000);
    expect(voice.getState()).toEqual({ kind: "listening" });
    vi.advanceTimersByTime(1000);
    expect(voice.getState()).toEqual({ kind: "idle" });
    expect(recognizer.calls).toEqual(["start", "stop"]);
  });

  it("reports no speech when the silence timeout passes before any words", () => {
    const { voice } = buildVoiceInput({});
    const recognizer = startListening(voice);
    vi.advanceTimersByTime(5000);
    expect(voice.getState()).toEqual({ kind: "error", error: "no-speech" });
    expect(recognizer.calls).toEqual(["start", "abort"]);
  });

  it("starts the silence timeout only once the recognizer has started", () => {
    const { voice } = buildVoiceInput({});
    voice.start();
    const recognizer = lastRecognizer();
    vi.advanceTimersByTime(30_000);
    expect(voice.getState()).toEqual({ kind: "listening" });
    recognizer.onstart?.();
    vi.advanceTimersByTime(5000);
    expect(voice.getState()).toEqual({ kind: "error", error: "no-speech" });
  });

  it("joins results with the separator for the language", () => {
    const { voice, texts } = buildVoiceInput({ separator: "" });
    const recognizer = startListening(voice);
    recognizer.emit([
      { transcript: "我想要", isFinal: true },
      { transcript: "一个沙发", isFinal: false },
    ]);
    expect(texts).toEqual(["我想要一个沙发"]);
  });

  it("ends idle when an error follows a stop", () => {
    const { voice } = buildVoiceInput({});
    const recognizer = startListening(voice);
    voice.stop();
    recognizer.onerror?.({ error: "network" });
    expect(voice.getState()).toEqual({ kind: "idle" });
  });

  it("reports no text after stop and ends at the recognizer's end", () => {
    const { voice, texts, states } = buildVoiceInput({});
    const recognizer = startListening(voice);
    recognizer.emit([{ transcript: "a rug", isFinal: false }]);
    voice.stop();
    expect(voice.getState()).toEqual({ kind: "idle" });
    recognizer.emit([{ transcript: "a rug by the bed", isFinal: true }]);
    recognizer.onend?.();
    expect(texts).toEqual(["a rug"]);
    expect(states).toEqual([{ kind: "listening" }, { kind: "idle" }]);
    expect(recognizer.onresult).toBeNull();
  });

  it("aborts a stopped recognizer that never ends after the grace time", () => {
    const { voice } = buildVoiceInput({});
    const recognizer = startListening(voice);
    voice.stop();
    vi.advanceTimersByTime(1499);
    expect(recognizer.calls).toEqual(["start", "stop"]);
    vi.advanceTimersByTime(1);
    expect(recognizer.calls).toEqual(["start", "stop", "abort"]);
    expect(recognizer.onresult).toBeNull();
  });

  it("aborts at once when stopped before the recognizer started", () => {
    const { voice } = buildVoiceInput({});
    voice.start();
    voice.stop();
    expect(lastRecognizer().calls).toEqual(["start", "abort"]);
    expect(voice.getState()).toEqual({ kind: "idle" });
  });

  it("starts the silence timeout on audio start or the first result", () => {
    const { voice } = buildVoiceInput({});
    voice.start();
    lastRecognizer().onaudiostart?.();
    vi.advanceTimersByTime(5000);
    expect(voice.getState()).toEqual({ kind: "error", error: "no-speech" });
    voice.start();
    lastRecognizer().emit([{ transcript: "", isFinal: false }]);
    vi.advanceTimersByTime(5000);
    expect(voice.getState()).toEqual({ kind: "error", error: "no-speech" });
  });

  it("goes idle when the recognizer ends by itself and restarts with a new one", () => {
    const { voice } = buildVoiceInput({});
    const first = startListening(voice);
    first.onend?.();
    expect(voice.getState()).toEqual({ kind: "idle" });
    voice.start();
    expect(FakeRecognizer.instances).toHaveLength(2);
    expect(voice.getState()).toEqual({ kind: "listening" });
  });

  it("starts again with a new recognizer after an error", () => {
    const { voice } = buildVoiceInput({});
    const first = startListening(voice);
    first.onerror?.({ error: "network" });
    voice.start();
    expect(FakeRecognizer.instances).toHaveLength(2);
    expect(lastRecognizer().calls).toEqual(["start"]);
    expect(voice.getState()).toEqual({ kind: "listening" });
  });

  it("ignores events from a cancelled recognizer", () => {
    const { voice, texts } = buildVoiceInput({});
    voice.start();
    const recognizer = lastRecognizer();
    const onresult = recognizer.onresult;
    voice.cancel();
    expect(recognizer.calls).toEqual(["start", "abort"]);
    expect(recognizer.onresult).toBeNull();
    onresult?.({ results: [] });
    expect(voice.getState()).toEqual({ kind: "idle" });
    expect(texts).toEqual([]);
  });

  it("restarts with a new recognizer on the next start", () => {
    const { voice } = buildVoiceInput({});
    const first = startListening(voice);
    voice.stop();
    voice.start();
    expect(FakeRecognizer.instances).toHaveLength(2);
    expect(first.calls).toEqual(["start", "stop", "abort"]);
    expect(first.onresult).toBeNull();
    expect(voice.getState()).toEqual({ kind: "listening" });
  });

  it.each([
    ["not-allowed", "permission-denied"],
    ["service-not-allowed", "permission-denied"],
    ["audio-capture", "no-microphone"],
    ["network", "network"],
    ["no-speech", "no-speech"],
    ["language-not-supported", "language-not-supported"],
    ["bad-grammar", "failed"],
  ] as const)(
    "maps the %s error to %s and keeps it after end",
    (code, error) => {
      const { voice } = buildVoiceInput({});
      voice.start();
      const recognizer = lastRecognizer();
      const onend = recognizer.onend;
      recognizer.onerror?.({ error: code });
      onend?.();
      expect(voice.getState()).toEqual({ kind: "error", error });
    },
  );

  it("treats an aborted recognizer as idle", () => {
    const { voice } = buildVoiceInput({});
    voice.start();
    lastRecognizer().onerror?.({ error: "aborted" });
    expect(voice.getState()).toEqual({ kind: "idle" });
  });

  it("clears an error on cancel", () => {
    const { voice } = buildVoiceInput({});
    voice.start();
    lastRecognizer().onerror?.({ error: "network" });
    voice.cancel();
    expect(voice.getState()).toEqual({ kind: "idle" });
  });

  it("reports a failure when the recognizer refuses to start", () => {
    class ThrowingRecognizer extends FakeRecognizer {
      override start() {
        throw new Error("InvalidStateError");
      }
    }
    const { voice } = buildVoiceInput({ Recognizer: ThrowingRecognizer });
    voice.start();
    expect(voice.getState()).toEqual({ kind: "error", error: "failed" });
  });
});
