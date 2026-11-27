import { type Material, Texture } from "three";
import type { ColorAdjustUniforms } from "./color-adjust-uniforms.ts";

const fragmentHelpers = /* glsl */ `
uniform int uColorMode;
uniform vec3 uColorTarget;
uniform float uColorStrength;
uniform vec3 uColorShift;
uniform float uReferenceLuma;
#ifdef USE_COLOR_MASK
uniform sampler2D uColorMask;
#endif

vec3 colorAdjustToSrgb(vec3 linear) {
  return mix(linear * 12.92, 1.055 * pow(linear, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), linear));
}

vec3 colorAdjustToLinear(vec3 srgb) {
  return mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), srgb));
}

vec3 colorAdjustRgbToHsl(vec3 c) {
  float high = max(max(c.r, c.g), c.b);
  float low = min(min(c.r, c.g), c.b);
  float lightness = (high + low) * 0.5;
  float range = high - low;
  if (range < 1e-5) return vec3(0.0, 0.0, lightness);
  float saturation = range / (1.0 - abs(2.0 * lightness - 1.0));
  float hue = c.r == high ? mod((c.g - c.b) / range, 6.0)
    : c.g == high ? (c.b - c.r) / range + 2.0
    : (c.r - c.g) / range + 4.0;
  return vec3(hue / 6.0, saturation, lightness);
}

vec3 colorAdjustHslToRgb(vec3 hsl) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + hsl.x * 12.0, 12.0);
  float a = hsl.y * min(hsl.z, 1.0 - hsl.z);
  return hsl.z - a * clamp(min(k - 3.0, 9.0 - k), -1.0, 1.0);
}

vec3 colorAdjustApply(vec3 linear) {
  vec3 pixel = colorAdjustToSrgb(clamp(linear, 0.0, 1.0));
  vec3 result = pixel;
  if (uColorMode == 1) {
    float shading = dot(pixel, vec3(0.3, 0.59, 0.11)) / max(uReferenceLuma, 0.02);
    result = mix(pixel, clamp(uColorTarget * shading, 0.0, 1.0), uColorStrength);
  } else if (uColorMode == 2) {
    vec3 hsl = colorAdjustRgbToHsl(pixel);
    hsl.x = fract(hsl.x + uColorShift.x / 360.0);
    hsl.yz = clamp(hsl.yz + uColorShift.yz, 0.0, 1.0);
    result = colorAdjustHslToRgb(hsl);
  }
  return colorAdjustToLinear(result);
}
`;

const applyChunk = /* glsl */ `
#include <color_fragment>
if (uColorMode != 0) {
  vec3 colorAdjusted = colorAdjustApply(diffuseColor.rgb);
  #ifdef USE_COLOR_MASK
  diffuseColor.rgb = mix(diffuseColor.rgb, colorAdjusted, texture2D(uColorMask, vMapUv).r);
  #else
  diffuseColor.rgb = colorAdjusted;
  #endif
}
`;

/** Make `material` apply the colour adjustment held in `uniforms` to its base colour, inside any supplied `colorMask` when `material` has a base map, and return `material`. */
export function patchColorAdjust(options: {
  material: Material;
  uniforms: ColorAdjustUniforms;
  colorMask: Texture | undefined;
}) {
  const { material, uniforms } = options;
  const baseMap =
    "map" in material && material.map instanceof Texture
      ? material.map
      : undefined;
  const colorMask =
    options.colorMask !== undefined && baseMap !== undefined
      ? Object.assign(options.colorMask.clone(), {
          flipY: false,
          wrapS: baseMap.wrapS,
          wrapT: baseMap.wrapT,
        })
      : undefined;
  const hasMask = colorMask !== undefined;
  function disposeMask() {
    colorMask?.dispose();
  }
  if (hasMask) {
    colorMask.needsUpdate = true;
    material.addEventListener("dispose", disposeMask);
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (hasMask) {
      shader.uniforms.uColorMask = { value: colorMask };
      shader.defines = { ...shader.defines, USE_COLOR_MASK: "" };
    }
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${fragmentHelpers}\nvoid main() {`)
      .replace("#include <color_fragment>", applyChunk);
  };
  material.customProgramCacheKey = () =>
    hasMask ? "color-adjust-mask" : "color-adjust";
  material.needsUpdate = true;
  return material;
}
