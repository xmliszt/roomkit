export const steps = [
  { kind: "tool", name: "scene_get" },
  {
    kind: "tool",
    name: "asset_variant",
    arguments: (results) => ({
      itemId: results.scene_get.scene.items.find((item) => item.name === "Sofa")
        .id,
      name: "Blue sofa",
      change: { kind: "color", color: "#1e50e6", strength: 1 },
    }),
  },
  { kind: "text", text: "Queued the blue sofa." },
];
