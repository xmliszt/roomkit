import type { Vec3 } from "./vec3.ts";

/** Where an item's anchor sits and how it turns: `yawRad` about world +Y, then `rollRad` about the item's own +Z (three.js Euler order `YXZ`). */
export type ItemFrame = { positionM: Vec3; yawRad: number; rollRad: number };
