export type GenerationAction =
  | { kind: "start" }
  | { kind: "alternatives" }
  | { kind: "regenerate"; notes: string }
  | { kind: "retry" }
  | { kind: "color-variant"; color: string }
  | { kind: "shape-variant"; prompt: string }
  | { kind: "keep"; assetId: string };
