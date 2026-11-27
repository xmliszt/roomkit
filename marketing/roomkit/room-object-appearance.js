import * as THREE from "three";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";

const timing = {
  gatherAt: 600,
  gather: 900,
  traceAt: 1100,
  trace: 900,
  revealAt: 1700,
  reveal: 700,
  pointsOutAt: 2100,
  linesOutAt: 2400,
  fade: 400,
};

function progress(elapsed, at, duration) {
  return THREE.MathUtils.clamp((elapsed - at) / duration, 0, 1);
}

export function createObjectAppearance({ item, scene, pixelRatio }) {
  const bounds = new THREE.Box3().setFromObject(item);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scatter = [];
  const surface = [];
  const colors = [];
  const edges = [];
  const stored = [];
  const hit = new THREE.Vector3();
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0));

  item.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const vertices = mesh.geometry.getAttribute("position");
    if (!vertices || vertices.count < 3) return;
    const original = mesh.material;
    const materials = (Array.isArray(original) ? original : [original]).map(
      (material) => {
        const clipped = material.clone();
        clipped.clippingPlanes = [plane];
        return clipped;
      },
    );
    stored.push({ mesh, original, materials });
    const color = materials[0].color ?? new THREE.Color("#ab9d89");
    const sampler = new MeshSurfaceSampler(mesh).build();
    const count = Math.min(
      1680,
      Math.max(180, Math.ceil(Math.sqrt(vertices.count) * 13)),
    );
    for (let index = 0; index < count; index += 1) {
      sampler.sample(hit);
      hit.applyMatrix4(mesh.matrixWorld);
      surface.push(...hit);
      scatter.push(
        bounds.min.x + Math.random() * size.x,
        bounds.min.y + Math.random() * size.y,
        bounds.min.z + Math.random() * size.z,
      );
      colors.push(color.r, color.g, color.b);
    }

    const wire = new THREE.EdgesGeometry(mesh.geometry, 28);
    const positions = wire.getAttribute("position");
    for (let index = 0; index < positions.count; index += 2) {
      start
        .fromBufferAttribute(positions, index)
        .applyMatrix4(mesh.matrixWorld);
      end
        .fromBufferAttribute(positions, index + 1)
        .applyMatrix4(mesh.matrixWorld);
      edges.push({
        length: start.distanceToSquared(end),
        points: [...start, ...end],
      });
    }
    wire.dispose();
  });

  const solid = new THREE.BoxGeometry(...size);
  const boxEdges = new THREE.EdgesGeometry(solid);
  boxEdges.translate(...center);
  solid.dispose();
  const box = new THREE.LineSegments(
    boxEdges,
    new THREE.LineDashedMaterial({
      color: "#1e50e6",
      transparent: true,
      dashSize: 0.03,
      gapSize: 0.02,
      depthWrite: false,
    }),
  );
  box.computeLineDistances();

  const tracePositions = edges
    .sort((a, b) => b.length - a.length)
    .slice(0, 120)
    .flatMap(({ points }) => points);
  const traceGeometry = new THREE.BufferGeometry();
  traceGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(tracePositions, 3),
  );
  const trace = new THREE.LineSegments(
    traceGeometry,
    new THREE.LineBasicMaterial({
      color: "#1b2430",
      transparent: true,
      depthWrite: false,
    }),
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(scatter, 3),
  );
  geometry.setAttribute("target", new THREE.Float32BufferAttribute(surface, 3));
  geometry.setAttribute("tint", new THREE.Float32BufferAttribute(colors, 3));
  const dots = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        density: { value: 0 },
        gather: { value: 0 },
        opacity: { value: 1 },
        time: { value: 0 },
        pixelRatio: { value: pixelRatio },
      },
      vertexShader: `
      attribute vec3 target, tint;
      uniform float density, gather, opacity, time, pixelRatio;
      varying vec3 vColor;
      varying float vAlpha, vFocus;
      void main() {
        float seed = fract(sin(float(gl_VertexID) * 12.9898 + 6.78) * 43758.5453);
        float t = clamp(gather * 1.5 - seed * .5, 0., 1.);
        float focus = max(smoothstep(0., 1., t), smoothstep(seed, seed + .5, density) * .50);
        vec3 wobble = .03 * (1. -.8 * focus) * vec3(sin(time *.7 + seed * 40.), cos(time *.55 + seed * 71.), sin(time *.6 + seed * 13.));
        vec4 view = modelViewMatrix * vec4(t < .5 ? position + wobble : target, 1.);
        vColor = mix(vec3(.118,.314,.902), tint, t);
        vFocus = focus;
        vAlpha = opacity * smoothstep(0., .08, density - seed) * abs(2. * t - 1.) * mix(.24, .95, focus);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(mix(4.8, 2.0, focus) * (.55 + seed * .68) * 10. / -view.z, 1.15, 5.) * pixelRatio;
      }`,
      fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha, vFocus;
      void main() {
        float d = 2. * length(gl_PointCoord - .5);
        float soft = exp(-d * d * 3.5) * (1. - smoothstep(.76, 1., d));
        gl_FragColor = vec4(vColor, vAlpha * mix(soft, 1. - smoothstep(.68, 1., d), vFocus));
      }`,
    }),
  );
  dots.frustumCulled = false;
  scene.add(box, trace, dots);

  function seek(elapsed, shown) {
    const gather = progress(elapsed, timing.gatherAt, timing.gather);
    const reveal = progress(elapsed, timing.revealAt, timing.reveal);
    const active = shown && elapsed >= 0;
    box.material.opacity = 0.68 * (1 - gather);
    box.visible = active && box.material.opacity > 0;
    trace.material.opacity =
      0.83 * (1 - progress(elapsed, timing.linesOutAt, timing.fade));
    const traceProgress = progress(elapsed, timing.traceAt, timing.trace);
    trace.geometry.setDrawRange(
      0,
      2 * Math.ceil((traceProgress * tracePositions.length) / 6),
    );
    trace.visible = active && traceProgress > 0 && trace.material.opacity > 0;
    const uniforms = dots.material.uniforms;
    uniforms.gather.value = gather;
    uniforms.density.value =
      0.04 + 1.25 * progress(elapsed, 0, timing.gatherAt);
    uniforms.opacity.value =
      1 - progress(elapsed, timing.pointsOutAt, timing.fade);
    uniforms.time.value = Math.max(0, elapsed / 1000);
    dots.visible = active && uniforms.opacity.value > 0;
    item.visible = shown && reveal > 0;
    plane.constant = bounds.min.y + size.y * (1 - (1 - reveal) ** 3) + 0.002;
    for (const { mesh, original, materials } of stored) {
      mesh.material =
        reveal > 0 && reveal < 1
          ? Array.isArray(original)
            ? materials
            : materials[0]
          : original;
    }
  }

  return {
    item,
    durationMs: timing.linesOutAt + timing.fade,
    seek,
    dispose() {
      scene.remove(box, trace, dots);
      for (const object of [box, trace, dots]) {
        object.geometry.dispose();
        object.material.dispose();
      }
      for (const { mesh, original, materials } of stored) {
        mesh.material = original;
        for (const material of materials) material.dispose();
      }
    },
  };
}
