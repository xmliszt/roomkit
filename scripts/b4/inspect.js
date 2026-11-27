import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const WALL_COLOR = 0xe9e6e0;

/** Load the GLB at `url` and return its bounding box, triangle count and the number of meshes with a node transform. */
window.inspectGlb = async (url) => {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene, true);
  const identity = new THREE.Matrix4();
  const meshes = [];
  gltf.scene.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  return {
    min: box.min.toArray(),
    max: box.max.toArray(),
    meshCount: meshes.length,
    transformedMeshCount: meshes.filter(
      (mesh) => !mesh.matrixWorld.equals(identity),
    ).length,
    triangleCount: meshes.reduce((sum, mesh) => {
      const index = mesh.geometry.getIndex();
      return (
        sum +
        (index ? index.count : mesh.geometry.getAttribute("position").count) / 3
      );
    }, 0),
  };
};

/** Render the GLB at `url`, scaled to `sizeM`, on a wall seen from slightly above and to the right; return a PNG data URL. */
window.renderGlb = async (options) => {
  const gltf = await new GLTFLoader().loadAsync(options.url);
  const native = new THREE.Box3()
    .setFromObject(gltf.scene, true)
    .getSize(new THREE.Vector3());
  gltf.scene.scale.set(
    options.sizeM.width / native.x,
    options.sizeM.height / native.y,
    options.sizeM.depth / native.z,
  );
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(options.sizePx, options.sizePx);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(WALL_COLOR);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(
    new RoomEnvironment(),
    0.04,
  ).texture;
  scene.environmentIntensity = 0.45;
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.9 }),
  );
  wall.receiveShadow = true;
  scene.add(wall);
  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  scene.add(gltf.scene);
  const light = new THREE.DirectionalLight(0xffffff, 2.4);
  light.position.set(-0.45, 0.7, 0.6);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.left = -0.15;
  light.shadow.camera.right = 0.15;
  light.shadow.camera.top = 0.15;
  light.shadow.camera.bottom = -0.15;
  light.shadow.bias = -0.0002;
  light.shadow.radius = 4;
  scene.add(light);
  const span = Math.max(options.sizeM.width, options.sizeM.height);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  const distance = (span * 0.72) / Math.tan(THREE.MathUtils.degToRad(15));
  camera.position.set(0.18, 0.14, 1).normalize().multiplyScalar(distance);
  camera.lookAt(0, 0, options.sizeM.depth / 2);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  renderer.dispose();
  return url;
};

window.inspectReady = true;
