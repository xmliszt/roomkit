import type { AssetMeta } from "@planner/shared/src/scene/asset-meta-schema.ts";
import { Color, Mesh, type Object3D, Vector3 } from "three";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import { GENERATION_POINTS } from "../generation/appearance-timing.ts";

export function createCatalogAppearanceData(options: {
  model: Object3D;
  meta: AssetMeta;
  creases: number[];
}) {
  const meshes: Mesh[] = [];
  options.model.updateWorldMatrix(true, true);
  options.model.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  const samplers = meshes.map((mesh) => new MeshSurfaceSampler(mesh).build());
  const positions = new Float32Array(GENERATION_POINTS.count * 3);
  const colors = new Float32Array(GENERATION_POINTS.count * 3);
  const point = new Vector3();
  const color = new Color();
  for (let index = 0; index < GENERATION_POINTS.count; index++) {
    const mesh = meshes.at(index % meshes.length);
    const sampler = samplers.at(index % meshes.length);
    if (!mesh || !sampler) continue;
    sampler.sample(point);
    point.applyMatrix4(mesh.matrixWorld).toArray(positions, index * 3);
    const material = Array.isArray(mesh.material)
      ? mesh.material.at(0)
      : mesh.material;
    color.set(
      material && "color" in material && material.color instanceof Color
        ? material.color
        : "#ffffff",
    );
    color.convertLinearToSRGB().toArray(colors, index * 3);
  }
  return {
    meta: options.meta,
    points: { positions, colors },
    lines: options.creases,
  };
}
