import type { CatalogEntry } from "./catalog-entry.ts";
import { CHARGING_PORT } from "./charging-port.ts";

const family = {
  familyId: CHARGING_PORT.familyId,
  name: CHARGING_PORT.name,
  mount: CHARGING_PORT.mount,
  defaultHeightM: CHARGING_PORT.defaultHeightM,
};

/** The charging port types the user can pick from, the default (Type G) first. */
export const CHARGING_PORT_TYPES = [
  CHARGING_PORT,
  {
    ...family,
    typeId: "type-g-usb",
    label: "Type G with USB-A and USB-C",
    assetId: "charging-port-type-g-usb",
    sizeM: { width: 0.086, height: 0.086, depth: 0.01 },
  },
  {
    ...family,
    typeId: "type-g-double",
    label: "Type G double",
    assetId: "charging-port-type-g-double",
    sizeM: { width: 0.146, height: 0.086, depth: 0.01 },
  },
  {
    ...family,
    typeId: "type-a-b",
    label: "Type A/B (US, Japan)",
    assetId: "charging-port-type-a-b",
    sizeM: { width: 0.06985, height: 0.1143, depth: 0.0075 },
  },
  {
    ...family,
    typeId: "type-c-f",
    label: "Type C/F (Schuko, EU)",
    assetId: "charging-port-type-c-f",
    sizeM: { width: 0.0807, height: 0.0807, depth: 0.011 },
  },
  {
    ...family,
    typeId: "type-i",
    label: "Type I (Australia, China)",
    assetId: "charging-port-type-i",
    sizeM: { width: 0.115, height: 0.073, depth: 0.009 },
  },
  {
    ...family,
    typeId: "usb",
    label: "USB-A and USB-C",
    assetId: "charging-port-usb",
    sizeM: { width: 0.086, height: 0.086, depth: 0.0088 },
  },
] as const satisfies readonly CatalogEntry[];
