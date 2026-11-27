/** A pointer hit on a surface an item can mount on, in the numbers its placement uses. */
export type SurfaceHit =
  | { kind: "horizontal"; xM: number; zM: number }
  | { kind: "wall"; wallId: string; alongM: number; heightM: number };
