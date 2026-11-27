import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { roomLighting } from "./room-lighting.js";

export const roomBounds = {
  left: -1.587,
  right: 1.587,
  back: -2.738,
  front: 2.739,
  height: 2.896,
};
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let model;

export async function createRoomView(
  viewport,
  { transparent = true, shadows = false } = {},
) {
  model ??= loader.loadAsync(
    new URL("./assets/living-room.glb", import.meta.url).href,
  );
  const asset = await model;
  const room = asset.scene.clone(true);
  for (const part of [...room.children]) {
    if (part.userData.placement === "ceiling") part.removeFromParent();
  }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.03, 42);
  const renderer = new THREE.WebGLRenderer({
    alpha: transparent,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");

  room.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  const walls = room.children.filter((part) =>
    Array.isArray(part.userData.outward),
  );
  const furniture = room.children.filter((part) => part.userData.placement);
  const ceiling = room.getObjectByName("Ceiling");
  const floor = room.getObjectByName("Floor");
  const chair = furniture.find((part) => part.userData.reference);
  const lamp = furniture.find((part) => part.userData.lamp);
  const exteriorFillIntensity = 1.6;
  const exteriorFill = new THREE.HemisphereLight(
    "#fcfcff",
    "#d5c7ae",
    exteriorFillIntensity,
  );

  function pointLight(source) {
    const light = new THREE.PointLight(
      new THREE.Color(...source.color),
      source.intensity,
    );
    light.position.set(...source.position);
    return light;
  }

  const ceilingLight = pointLight(roomLighting.ceiling);
  ceilingLight.castShadow = shadows;
  ceilingLight.shadow.autoUpdate = false;
  ceilingLight.shadow.mapSize.set(512, 512);
  ceilingLight.shadow.normalBias = 0.018;
  const fill = pointLight(roomLighting.fill);
  const localLight = pointLight(roomLighting.lamp);
  if (lamp) lamp.attach(localLight);

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(
      roomBounds.right - roomBounds.left,
      0.085,
      roomBounds.front - roomBounds.back,
    ),
    new THREE.MeshStandardMaterial({ color: "#cbc3b6", roughness: 0.85 }),
  );
  slab.position.y = -0.052;
  scene.add(room, slab, exteriorFill, ceilingLight, fill);
  if (!lamp) scene.add(localLight);

  function updateShadows() {
    if (shadows) ceilingLight.shadow.needsUpdate = true;
  }
  updateShadows();

  const windowBackdrop = new THREE.Color("#827d70");

  function setCutaway(active, strength = Number(active)) {
    renderer.setClearColor(windowBackdrop, 1 - strength);
    if (ceiling && ceiling.visible === active) {
      ceiling.visible = !active;
      updateShadows();
    }
    exteriorFill.visible = strength > 0;
    exteriorFill.intensity = exteriorFillIntensity * strength;
    walls.forEach((wall, index) => {
      const [x, z] = wall.userData.outward;
      const isVisible =
        !active || camera.position.x * x + camera.position.z * z < 0.14;
      if (wall.visible !== isVisible) updateShadows();
      wall.visible = isVisible;
      for (const item of furniture) {
        if (item.userData.wall === index + 1) item.visible = isVisible;
      }
    });
  }

  function resize(target = viewport) {
    const width = target.clientWidth;
    const height = target.clientHeight;
    if (width === 0 || height === 0) return false;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    return true;
  }

  function loop(draw) {
    function tick(time) {
      if (draw(time) !== false) frame = requestAnimationFrame(tick);
    }
    let frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }

  return {
    scene,
    camera,
    renderer,
    canvas,
    walls,
    furniture,
    floor,
    slab,
    chair,
    lamp,
    localLight,
    resize,
    setCutaway,
    updateShadows,
    loop,
  };
}
