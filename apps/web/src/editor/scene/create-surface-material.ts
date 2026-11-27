import type { SurfaceMaterial } from "@planner/shared/src/scene/surface-material-schema.ts";
import { Color, MeshStandardMaterial, type Texture, Vector2 } from "three";

export function createSurfaceMaterial(options: {
  material: SurfaceMaterial;
  color: string;
  environment: Texture;
}) {
  const source = options.material;
  const { repeat, roughness, color, groutWidthM, groutColor } = (() => {
    switch (source.kind) {
      case "paint":
        return {
          repeat: { u: 1, v: 1 },
          roughness: { matte: 0.95, eggshell: 0.65, satin: 0.35 }[
            source.finish
          ],
          color: source.color,
          groutWidthM: 0,
          groutColor: new Color(options.color),
        };
      case "texture":
        return {
          repeat: source.repeatSizeM,
          roughness: source.roughness,
          color: "#ffffff",
          groutWidthM: 0,
          groutColor: new Color(options.color),
        };
      case "tiles":
        return {
          repeat: source.tileSizeM,
          roughness: source.roughness,
          color: source.textureAssetId ? "#ffffff" : source.baseColor,
          groutWidthM: source.groutWidthM,
          groutColor: new Color(source.groutColor),
        };
      case "planks":
        return {
          repeat: source.plankSizeM,
          roughness: source.roughness,
          color: source.textureAssetId ? "#ffffff" : source.baseColor,
          groutWidthM: 0.001,
          groutColor: new Color(options.color).multiplyScalar(0.55),
        };
      default: {
        const unreachable: never = source;
        return unreachable;
      }
    }
  })();
  const material = new MeshStandardMaterial({
    color,
    roughness,
    envMap: options.environment,
    envMapIntensity: 0.18,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.surfaceRepeat = { value: new Vector2(repeat.u, repeat.v) };
    shader.uniforms.groutWidthM = { value: groutWidthM };
    shader.uniforms.groutColor = { value: groutColor };
    shader.vertexShader =
      `varying vec2 surfaceUvM;\n${shader.vertexShader}`.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nsurfaceUvM = uv;",
      );
    shader.fragmentShader =
      `varying vec2 surfaceUvM;\nuniform vec2 surfaceRepeat;\nuniform float groutWidthM;\nuniform vec3 groutColor;\n${shader.fragmentShader}`.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
      vec2 edgeM = abs(fract(surfaceUvM / surfaceRepeat + 0.5) - 0.5) * surfaceRepeat;
      vec2 antialiasM = max(fwidth(surfaceUvM), vec2(0.00001));
      vec2 seam = vec2(1.0) - smoothstep(vec2(groutWidthM * 0.5) - antialiasM * 0.5, vec2(groutWidthM * 0.5) + antialiasM * 0.5, edgeM);
      float grout = groutWidthM > 0.0 ? max(seam.x, seam.y) : 0.0;
      diffuseColor.rgb = mix(diffuseColor.rgb, groutColor, grout);
    `,
      );
  };
  material.customProgramCacheKey = () => "room-surface";
  return { material, repeat };
}
