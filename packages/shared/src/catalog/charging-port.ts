import type { CatalogEntry } from "./catalog-entry.ts";

export const CHARGING_PORT = {
  familyId: "charging-port",
  typeId: "type-g",
  name: "Charging port",
  label: "Type G (UK, Malaysia, Singapore)",
  assetId: "charging-port",
  mount: "wall",
  sizeM: { width: 0.086, height: 0.086, depth: 0.01 },
  defaultHeightM: 0.3,
} as const satisfies CatalogEntry;
