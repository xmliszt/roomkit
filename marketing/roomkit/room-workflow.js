import * as THREE from "three";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import { createObjectAppearance } from "./room-object-appearance.js";
import { createRoomView, roomBounds } from "./room-scene.js";

const timing = {
  cloud: 720,
  floor: 600,
  wallsAt: 650,
  walls: 1100,
  pointsOutAt: 1800,
  pointsOut: 400,
};
const position = new THREE.Vector3();
const corners = [
  [roomBounds.left, roomBounds.back],
  [roomBounds.left, roomBounds.front],
  [roomBounds.right, roomBounds.front],
  [roomBounds.right, roomBounds.back],
  [roomBounds.left, roomBounds.back],
].map(([x, z]) => new THREE.Vector3(x, 0.005, z));
const perimeter = corners
  .slice(1)
  .reduce((length, end, index) => length + end.distanceTo(corners[index]), 0);
const walkCycleMs = 12800;
const furnitureAtMs = 1480;
const furnitureStaggerMs = 175;
const animatedNames = [
  "TV console",
  "Sofa",
  "Acoustic guitar",
  "Standing desk",
  "Floor lamp",
  "Mini fridge",
];

function ease(value) {
  return 1 - (1 - THREE.MathUtils.clamp(value, 0, 1)) ** 3;
}

function collectPoints(objects) {
  const points = [];
  const colors = [];
  for (const root of objects) {
    root.updateWorldMatrix(true, true);
    root.traverse((mesh) => {
      const vertices = mesh.geometry?.getAttribute("position")?.count;
      if (!mesh.isMesh || !vertices || mesh.material.transparent) return;
      const { index } = mesh.geometry;
      if (
        !mesh.geometry.hasAttribute("position") ||
        (index?.count ?? vertices) < 3
      )
        return;
      const material = Array.isArray(mesh.material)
        ? mesh.material[0]
        : mesh.material;
      const color = material.color ?? new THREE.Color("#aca28f");
      const sampler = new MeshSurfaceSampler(mesh).build();
      const count = THREE.MathUtils.clamp(
        Math.ceil(Math.sqrt(vertices) * 10),
        96,
        1100,
      );
      for (let i = 0; i < count; i += 1) {
        sampler.sample(position);
        position.applyMatrix4(mesh.matrixWorld);
        points.push(position.x, position.y, position.z);
        colors.push(color.r, color.g, color.b);
      }
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  geometry.setAttribute("tint", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      opacity: { value: 1 },
      reveal: { value: 1 },
      scale: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute vec3 tint;
      uniform float time, opacity, reveal, scale;
      varying vec3 dotTint;
      varying float alpha;
      void main() {
        float seed = fract(sin(float(gl_VertexID) * 12.9898 + 6.78) * 43758.5453);
        vec3 wobble = vec3(sin(time * 0.73 + seed * 31.), cos(time * 0.64 + seed * 67.), sin(time * 0.8 + seed * 12.));
        vec4 view = modelViewMatrix * vec4(position + wobble * (0.014 + seed * 0.018), 1.);
        dotTint = mix(tint, vec3(.11,.18,.29), .69);
        alpha = opacity * (0.32 + seed * .53) * smoothstep(0., .09, reveal - .85 * seed);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(18. * scale / -view.z, 1.25, 3.9);
      }`,
    fragmentShader: `
      varying float alpha;
      varying vec3 dotTint;
      void main() {
        float radius = length(gl_PointCoord - .5);
        gl_FragColor = vec4(dotTint, alpha * (1. - smoothstep(.25, .5, radius)));
      }`,
  });
  return new THREE.Points(geometry, material);
}

const walkPath = new THREE.CatmullRomCurve3(
  [
    [-1.06, 1.48, -2.2],
    [-0.15, 1.48, -1.6],
    [0.35, 1.48, -0.15],
    [0.22, 1.48, 1.42],
    [-0.54, 1.48, 1.15],
    [-0.89, 1.48, -0.53],
  ].map((pos) => new THREE.Vector3(...pos)),
  true,
  "catmullrom",
  0.45,
);
const walkGaze = new THREE.CatmullRomCurve3(
  [
    [0.42, 1.05, 0.91],
    [0.89, 1.11, 0.94],
    [0.89, 1.19, 2.05],
    [-1.2, 1.08, -0.18],
    [-0.94, 1.15, -1.43],
    [0.49, 1.16, -1.97],
  ].map((pos) => new THREE.Vector3(...pos)),
  true,
  "catmullrom",
  0.45,
);
const viewTarget = new THREE.Vector3(0, 1, 0);
let roomView;
let roomTransforms;

export async function showRoomDemo(viewport, stage, reduced, signal) {
  roomView ??= createRoomView(viewport);
  const view = await roomView;
  if (signal.aborted) return;
  const {
    camera,
    scene,
    renderer,
    canvas,
    walls,
    floor,
    slab,
    furniture,
    chair,
    resize,
    setCutaway,
    loop,
  } = view;
  roomTransforms ??= {
    walls: walls.map((wall) => ({ y: wall.position.y, scaleY: wall.scale.y })),
  };
  const watchingWalk = stage === "walk-room";
  const rebuilding = stage === "rebuild-room";
  const placing = stage === "place-furniture";
  const traceGeometry = new THREE.BufferGeometry().setFromPoints(corners);
  const trace = new THREE.Line(
    traceGeometry,
    new THREE.LineDashedMaterial({
      color: "#1b2430",
      transparent: true,
      opacity: 0.68,
      gapSize: perimeter * 2,
    }),
  );
  trace.computeLineDistances();
  const cloud =
    !reduced && rebuilding ? collectPoints([floor, ...walls]) : undefined;
  if (cloud) {
    cloud.material.uniforms.scale.value = renderer.getPixelRatio();
    scene.add(cloud, trace);
  }
  const animatedItems = reduced
    ? []
    : rebuilding
      ? animatedNames.flatMap((name) => {
          const item = furniture.find((part) => {
            const originalName = part.userData.name ?? part.name;
            return (
              !part.userData.reference &&
              (originalName === name || originalName.startsWith(`${name} `))
            );
          });
          return item ? [item] : [];
        })
      : placing && chair
        ? [chair]
        : [];
  const appearances = animatedItems.map((item, index) => ({
    effect: createObjectAppearance({
      item,
      scene,
      pixelRatio: renderer.getPixelRatio(),
    }),
    at: rebuilding ? furnitureAtMs + index * furnitureStaggerMs : 0,
  }));
  const animationEndMs = Math.max(
    timing.cloud + timing.pointsOutAt + timing.pointsOut,
    ...appearances.map(({ effect, at }) => at + effect.durationMs),
  );

  const started = performance.now();

  function draw(now) {
    const elapsed = now - started;
    if (watchingWalk) {
      const cycle = reduced ? 0 : (elapsed % walkCycleMs) / walkCycleMs;
      camera.fov = 51;
      walkPath.getPointAt(cycle, camera.position);
      camera.lookAt(walkGaze.getPointAt(cycle));
    } else {
      camera.fov = 36;
      camera.position.set(-5.9, 6.65, -6.7);
      camera.lookAt(viewTarget);
    }
    camera.updateProjectionMatrix();
    setCutaway(!watchingWalk);
    floor.visible = true;
    slab.visible = !watchingWalk;
    if (chair) chair.visible = watchingWalk || placing;
    for (const item of furniture) {
      if (rebuilding && item !== chair && !reduced && elapsed < 2450)
        item.visible = false;
      else if (!item.userData.wall && item !== chair) item.visible = true;
    }
    for (const { effect, at } of appearances) {
      const wall = effect.item.userData.wall;
      effect.seek(elapsed - at, !wall || walls[wall - 1].visible);
    }
    const roomElapsed = elapsed - timing.cloud;
    walls.forEach((wall, index) => {
      const height =
        rebuilding && !reduced
          ? Math.max(0.001, ease((roomElapsed - timing.wallsAt) / timing.walls))
          : 1;
      const transform = roomTransforms.walls[index];
      wall.position.y = transform.y * height;
      wall.scale.y = transform.scaleY * height;
    });
    if (rebuilding && !reduced) {
      floor.visible = roomElapsed >= timing.wallsAt;
      slab.visible = floor.visible;
      const progress = ease(roomElapsed / timing.floor);
      trace.visible = progress > 0 && roomElapsed < timing.pointsOutAt;
      trace.material.dashSize = perimeter * progress;
    }
    if (cloud) {
      const uniforms = cloud.material.uniforms;
      uniforms.time.value = elapsed / 1000;
      uniforms.reveal.value = ease(elapsed / 670) * 1.1;
      uniforms.opacity.value = reduced
        ? 0
        : rebuilding
          ? 1 - ease((roomElapsed - timing.pointsOutAt) / timing.pointsOut)
          : 1 - ease((elapsed - 1280) / 440);
      cloud.visible = uniforms.opacity.value > 0;
    }
    renderer.render(scene, camera);
    return watchingWalk || elapsed < animationEndMs;
  }

  viewport.prepend(canvas);
  resize(viewport);
  viewport.dataset.ready = "";
  draw(started);
  const stop = reduced ? undefined : loop(draw);
  const observer = new ResizeObserver(() => {
    if (resize(viewport)) draw(performance.now());
  });
  observer.observe(viewport);
  signal.addEventListener(
    "abort",
    () => {
      observer.disconnect();
      stop?.();
      if (cloud) {
        scene.remove(cloud, trace);
        cloud.geometry.dispose();
        cloud.material.dispose();
      }
      walls.forEach((wall, index) => {
        wall.position.y = roomTransforms.walls[index].y;
        wall.scale.y = roomTransforms.walls[index].scaleY;
      });
      for (const { effect } of appearances) effect.dispose();
      traceGeometry.dispose();
      trace.material.dispose();
      delete viewport.dataset.ready;
      canvas.remove();
    },
    { once: true },
  );
}
