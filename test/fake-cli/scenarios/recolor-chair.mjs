export const steps = [
  {
    kind: "tool",
    name: "scene_apply",
    arguments: {
      command: {
        type: "item.update",
        itemId: "chair",
        patch: {
          colorAdjust: { kind: "colorize", color: "#f97316", strength: 1 },
        },
      },
    },
  },
  { kind: "text", text: "The reading chair is orange." },
];
