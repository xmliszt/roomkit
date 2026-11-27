export type VoiceInputError =
  | "permission-denied"
  | "no-microphone"
  | "network"
  | "no-speech"
  | "language-not-supported"
  | "failed";

export type VoiceInputState =
  | { kind: "idle" }
  | { kind: "listening" }
  | { kind: "unavailable" }
  | { kind: "error"; error: VoiceInputError };
