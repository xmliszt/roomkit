import { steps as inventorySteps } from "./inventory.mjs";

export function steps() {
  return inventorySteps().map((step) => {
    if (step.name !== "inventory_submit") return step;
    return {
      ...step,
      arguments: {
        objects: step.arguments.objects.map((object) =>
          object.objectId === "tv"
            ? { ...object, name: "Sliding door", cutsOpening: true }
            : object,
        ),
      },
    };
  });
}
