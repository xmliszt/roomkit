import type { Material } from "three";
import type { ShadeGlow } from "./shade-glow.ts";

const vertexDeclaration = "varying vec3 vShadeGlowWorld;";
const vertexChunk = /* glsl */ `
#include <project_vertex>
vShadeGlowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const fragmentDeclaration = /* glsl */ `
varying vec3 vShadeGlowWorld;
uniform vec3 uShadeGlowCentre;
uniform vec3 uShadeGlowDirection;
uniform float uShadeGlowRadius;
uniform float uShadeGlowStrength;
`;
const fragmentChunk = /* glsl */ `
#include <emissivemap_fragment>
if (uShadeGlowStrength > 0.0) {
  vec3 shadeOffset = vShadeGlowWorld - uShadeGlowCentre;
  float shadeAlong = dot(shadeOffset, uShadeGlowDirection);
  float shadeMask = (1.0 - smoothstep(0.8 * uShadeGlowRadius, uShadeGlowRadius, length(shadeOffset)))
    * (1.0 - smoothstep(0.15 * uShadeGlowRadius, 0.25 * uShadeGlowRadius, shadeAlong));
  totalEmissiveRadiance += diffuseColor.rgb * uShadeGlowStrength * shadeMask;
}
`;

/** Make `material` glow in its own base colour inside the shade region that `glow`'s uniforms describe, keeping any `onBeforeCompile` it already has, and return `material`. */
export function patchShadeGlow(options: {
  material: Material;
  glow: ShadeGlow;
}) {
  const { material } = options;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, options.glow.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `${vertexDeclaration}\nvoid main() {`)
      .replace("#include <project_vertex>", vertexChunk);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${fragmentDeclaration}\nvoid main() {`)
      .replace("#include <emissivemap_fragment>", fragmentChunk);
  };
  material.customProgramCacheKey = () => `${previousKey}-shade-glow`;
  material.needsUpdate = true;
  return material;
}
