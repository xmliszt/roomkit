import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
} from "three";
import { getItemBox } from "../../items/get-item-box.ts";
import { isFloorCovering } from "../scene/is-floor-covering.ts";
import { GENERATION_POINTS } from "./appearance-timing.ts";

export function createGenerationPoints(options: {
  placementKind: Placement["kind"];
  sizeM: Size;
  accent: string;
  gatherFromSurface?: boolean | undefined;
  surface?: { positions: Float32Array; colors: Float32Array };
}) {
  const count = GENERATION_POINTS.count;
  const floorCovering = isFloorCovering({
    placementKind: options.placementKind,
    sizeM: options.sizeM,
  });
  const box = getItemBox({
    placementKind: options.placementKind,
    sizeM: options.sizeM,
  });
  const start = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  function random(index: number) {
    const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  }
  for (let index = 0; index < count; index++) {
    start.set(
      [
        box.x.min + random(index * 4) * options.sizeM.width,
        floorCovering
          ? box.y.max
          : box.y.min + random(index * 4 + 1) * options.sizeM.height,
        box.z.min + random(index * 4 + 2) * options.sizeM.depth,
      ],
      index * 3,
    );
    if (options.gatherFromSurface && options.surface) {
      for (let axis = 0; axis < 3; axis++) {
        start[index * 3 + axis] =
          (options.surface.positions[index * 3 + axis] ?? 0) +
          (random(index * 4 + axis) - 0.5) * 0.12;
      }
      if (floorCovering) start[index * 3 + 1] = box.y.max;
    }
    seeds[index] = random(index * 4 + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(start, 3));
  geometry.setAttribute(
    "aEnd",
    new BufferAttribute(options.surface?.positions ?? start, 3),
  );
  geometry.setAttribute(
    "aCol",
    new BufferAttribute(
      options.surface?.colors ?? new Float32Array(count * 3),
      3,
    ),
  );
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uT: { value: 0 },
      uGather: { value: options.gatherFromSurface ? 1 : 0 },
      uTime: { value: 0 },
      uDpr: { value: 1 },
      uAlpha: { value: 1 },
      uProg: { value: 0 },
      uFocus: { value: 0.8 },
      uAccent: { value: new Color(options.accent).convertLinearToSRGB() },
      uMaxSize: { value: GENERATION_POINTS.maxSizePx },
      uFocusedSize: { value: GENERATION_POINTS.focusedSizePx },
      uFloorCovering: { value: floorCovering ? 1 : 0 },
    },
    vertexShader: `attribute vec3 aEnd; attribute vec3 aCol; attribute float aSeed;
      uniform float uT, uTime, uDpr, uAlpha, uProg, uFocus, uMaxSize, uFocusedSize, uGather, uFloorCovering;
      uniform vec3 uAccent; varying vec3 vCol; varying float vA; varying float vFocus;
      void main() {
        float h = fract(aSeed * 7.13);
        float t = clamp(uT * 1.5 - aSeed * 0.5, 0.0, 1.0);
        t = 1.0 - pow(1.0 - t, 3.0);
        float age = clamp((uProg - aSeed) / 0.5, 0.0, 1.0);
        float focus = max(uFocus * age * (0.6 + 0.4 * h), t);
        vec3 wobble = (1.0 - 0.8 * focus) * 0.03 * vec3(sin(uTime * 0.7 + aSeed * 40.0), cos(uTime * 0.55 + aSeed * 71.0), sin(uTime * 0.6 + aSeed * 13.0));
        wobble.y *= 1.0 - uFloorCovering;
        vec3 at = uGather > 0.5 ? mix(position + wobble, aEnd, t) : (t < 0.5 ? position + wobble : aEnd);
        vec4 mv = modelViewMatrix * vec4(at, 1.0);
        vCol = mix(uAccent, aCol, uGather > 0.5 ? 1.0 : t);
        vFocus = focus;
        vA = uAlpha * (uGather > 0.5 ? 1.0 : abs(2.0 * t - 1.0)) * smoothstep(0.0, 0.05, uProg - aSeed) * mix(0.055, 0.95, pow(focus, 2.2));
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(uMaxSize, mix(uMaxSize, uFocusedSize, pow(focus, 0.8)) * (0.6 + 0.8 * h) * (11.8 / max(0.1, -mv.z))) * uDpr;
      }`,
    fragmentShader: `varying vec3 vCol; varying float vA; varying float vFocus;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (vA < 0.004 || d > 1.0) discard;
        float soft = exp(-d * d * 3.5) * (1.0 - smoothstep(0.8, 1.0, d));
        gl_FragColor = vec4(vCol, vA * mix(soft, 1.0 - smoothstep(0.7, 1.0, d), vFocus * vFocus));
      }`,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
