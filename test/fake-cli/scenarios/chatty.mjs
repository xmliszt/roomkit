export const steps = Array.from({ length: 8 }, (_, index) => [
  { kind: "sleep", durationMs: 150 },
  { kind: "text", text: `Working ${index + 1}` },
]).flat();
