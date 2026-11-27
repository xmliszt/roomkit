import type { Scene } from "@planner/shared/src/scene/scene-schema.ts";

const MAX_CHANGES = 12;

type Leaf = { label: string; value: string };

function formatValue(options: { path: string[]; value: unknown }) {
  const { value } = options;
  if (typeof value === "number") {
    const unitKey = options.path.findLast((key) => /(M|Rad)$/.test(key));
    if (unitKey?.endsWith("Rad"))
      return `${Math.round((value * 180) / Math.PI)}°`;
    if (unitKey !== undefined) return `${value.toFixed(2)} m`;
    return String(Number(value.toFixed(3)));
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function flatten(options: {
  value: unknown;
  owner: string;
  ownerKey: string;
  path: string[];
  into: { [path: string]: Leaf };
}) {
  const { value, owner, ownerKey, path, into } = options;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value))
      flatten({ value: entry, owner, ownerKey, path: [...path, key], into });
    return;
  }
  if (value === undefined) return;
  into[`${ownerKey}\u0000${path.join(".")}`] = {
    label: `${owner} · ${path.filter((key) => key !== "placement" && key !== "sizeM").join(" ")}`,
    value: formatValue({ path, value }),
  };
}

function describeScene(scene: Scene) {
  const leaves: { [path: string]: Leaf } = {};
  flatten({
    value: scene.room,
    owner: "room",
    ownerKey: "room",
    path: [],
    into: leaves,
  });
  flatten({
    value: scene.camera,
    owner: "camera",
    ownerKey: "camera",
    path: [],
    into: leaves,
  });
  for (const item of scene.items)
    flatten({
      value: { ...item, id: undefined },
      owner: item.name,
      ownerKey: `item:${item.id}`,
      path: [],
      into: leaves,
    });
  return leaves;
}

/** Return the labelled before and after values of every scene field that differs between `before` and `after`, at most 12. */
export function describeSceneChanges(options: { before: Scene; after: Scene }) {
  const before = describeScene(options.before);
  const after = describeScene(options.after);
  return Object.keys({ ...before, ...after })
    .filter((path) => before[path]?.value !== after[path]?.value)
    .slice(0, MAX_CHANGES)
    .map((path) => ({
      label: before[path]?.label ?? after[path]?.label ?? path,
      before: before[path]?.value ?? "—",
      after: after[path]?.value ?? "—",
    }));
}
