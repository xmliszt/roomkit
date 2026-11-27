type Vec3 = { x: number; y: number; z: number };

export type DimensionLine = {
  segments: [Vec3, Vec3][];
  labelM: Vec3;
  text: string;
};
