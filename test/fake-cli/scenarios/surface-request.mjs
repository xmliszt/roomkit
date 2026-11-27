export function steps({ prompt }) {
  return [
    {
      kind: "tool",
      name: "surface_set",
      arguments: {
        target: prompt.includes("all walls")
          ? { kind: "walls" }
          : {
              kind: "surface",
              surfaceId: /wall:([A-Za-z0-9_-]+)/.exec(prompt)?.at(1) ?? "floor",
            },
        prompt: prompt.includes("non-tileable")
          ? "non-tileable test"
          : prompt.includes("sage")
            ? "Sage green matte paint"
            : "Light oak planks",
      },
    },
    { kind: "text", text: "Surface job queued." },
  ];
}
