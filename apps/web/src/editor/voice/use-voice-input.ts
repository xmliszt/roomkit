import { type RefObject, useEffect, useRef, useState } from "react";
import { applyDictation } from "./apply-dictation.ts";
import { createVoiceInput } from "./create-voice-input.ts";
import { getWordSeparator } from "./get-word-separator.ts";
import type { VoiceInputState } from "./voice-input-state.ts";
import { voiceSilenceMs } from "./voice-silence-ms.ts";
import { voiceStopGraceMs } from "./voice-stop-grace-ms.ts";

/** Return the voice input `state` and the `start`, `cancel` and `toggle` controls that dictate into `inputRef` at its caret, leaving the text around the caret unchanged; `start` does nothing while `isPaused`. */
export function useVoiceInput(options: {
  inputRef: RefObject<HTMLInputElement | null>;
  isPaused: boolean;
}) {
  const [state, setState] = useState<VoiceInputState>({ kind: "idle" });
  const controllerRef = useRef<ReturnType<typeof createVoiceInput>>(undefined);
  const anchorRef = useRef({ before: "", after: "" });
  const writtenRef = useRef("");
  const inputRef = options.inputRef;

  useEffect(() => {
    const separator = getWordSeparator(navigator.language);
    const controller = createVoiceInput({
      Recognizer: window.SpeechRecognition ?? window.webkitSpeechRecognition,
      lang: navigator.language,
      separator,
      silenceMs: voiceSilenceMs,
      stopGraceMs: voiceStopGraceMs,
      onState: setState,
      onText: (text) => {
        const input = inputRef.current;
        if (input === null) return;
        if (input.value !== writtenRef.current) {
          controller.cancel();
          return;
        }
        const next = applyDictation({ ...anchorRef.current, text, separator });
        input.value = next.value;
        input.setSelectionRange(next.caret, next.caret);
        writtenRef.current = next.value;
      },
    });
    controllerRef.current = controller;
    setState(controller.getState());
    window.addEventListener("roomkit:window-close", controller.cancel);
    return () => {
      window.removeEventListener("roomkit:window-close", controller.cancel);
      controller.cancel();
      controllerRef.current = undefined;
    };
  }, [inputRef]);

  const isListening = state.kind === "listening";
  useEffect(() => {
    if (!isListening) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      controllerRef.current?.stop();
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isListening]);

  function start() {
    const controller = controllerRef.current;
    const input = inputRef.current;
    if (controller === undefined || input === null || options.isPaused) return;
    if (controller.getState().kind === "listening") return;
    const caret = input.selectionEnd ?? input.value.length;
    anchorRef.current = {
      before: input.value.slice(0, caret),
      after: input.value.slice(caret),
    };
    writtenRef.current = input.value;
    input.focus();
    controller.start();
  }

  return {
    state,
    isPaused: options.isPaused,
    start,
    cancel: () => controllerRef.current?.cancel(),
    toggle: () => (isListening ? controllerRef.current?.stop() : start()),
  };
}
