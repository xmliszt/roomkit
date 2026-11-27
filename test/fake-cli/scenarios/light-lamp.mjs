export const steps = [
  { kind: "tool", name: "scene_get" },
  {
    kind: "tool",
    name: "scene_apply",
    arguments: (results) => {
      const item = results.scene_get.scene.items.find((candidate) =>
        /lamp/i.test(candidate.name),
      );
      if (!item) throw new Error("No lamp in the scene");
      return {
        command: {
          type: "item.update",
          itemId: item.id,
          patch: {
            light: {
              on: true,
              emitter: { x: 0.5, y: 0.85, z: 0.5 },
              beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 },
              lumens: 400,
              temperatureK: 2700,
            },
          },
        },
      };
    },
  },
  { kind: "text", text: "Turned the lamp into a light." },
];
