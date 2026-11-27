function findPort(scene) {
  const item = scene.items.find(
    (candidate) =>
      candidate.placement.kind === "wall" &&
      /charging port/i.test(candidate.name),
  );
  if (!item) throw new Error("No charging port in the scene");
  return item;
}

export const steps = [
  { kind: "tool", name: "scene_get" },
  {
    kind: "tool",
    name: "scene_apply",
    arguments: (results) => {
      const item = findPort(results.scene_get.scene);
      return {
        command: {
          type: "item.update",
          itemId: item.id,
          patch: {
            placement: {
              ...item.placement,
              alongM: item.placement.alongM + 0.5,
            },
          },
        },
      };
    },
  },
  { kind: "text", text: "Moved the charging port 0.5 m left." },
];
