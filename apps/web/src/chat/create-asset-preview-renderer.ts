import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createSurfaceEnvironment } from "../editor/scene/create-surface-environment.ts";
import { objectEnvironmentIntensity } from "../editor/scene/object-environment-intensity.ts";
import { getAssetUrl } from "../items/get-asset-url.ts";

const previewSizePx = 96;
const rotationRadPerSecond = 0.65;
const orbitRadPerPx = 0.01;
const zoomPerWheelPx = 0.001;
const wheelLinePx = 16;
const maxElevationRad = 1.4;

type PreviewView = { kind: "turntable" } | { kind: "orbit" };

export function createAssetPreviewRenderer() {
  let renderer: WebGLRenderer | undefined;
  let target: HTMLElement | undefined;
  let release: (() => void) | undefined;
  let abort: (() => void) | undefined;
  let detach: (() => void) | undefined;
  let onStop: (() => void) | undefined;
  let resize: ((sizeM: Size) => void) | undefined;
  let view: PreviewView | undefined;
  let frameId = 0;
  let loadId = 0;
  const environment = createSurfaceEnvironment();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  function stop(node: HTMLElement) {
    if (target !== node) return;
    loadId++;
    abort?.();
    abort = undefined;
    cancelAnimationFrame(frameId);
    detach?.();
    detach = undefined;
    resize = undefined;
    renderer?.domElement.remove();
    release?.();
    release = undefined;
    target = undefined;
    view = undefined;
    const stopped = onStop;
    onStop = undefined;
    stopped?.();
  }

  async function load(options: {
    projectId: string;
    assetId: string;
    sizeM: Size;
    target: HTMLElement;
    view: PreviewView;
    onStop?: () => void;
  }) {
    if (target === options.target) return;
    if (options.view.kind === "turntable" && reducedMotion.matches) return;
    if (target) stop(target);
    target = options.target;
    view = options.view;
    onStop = options.onStop;
    const currentLoadId = ++loadId;
    renderer ??= new WebGLRenderer({ antialias: true });
    const gl = renderer;
    const sizePx =
      options.view.kind === "orbit"
        ? Math.max(previewSizePx, Math.round(options.target.clientWidth))
        : previewSizePx;
    gl.setPixelRatio(Math.min(devicePixelRatio, 2));
    gl.setSize(sizePx, sizePx);
    gl.domElement.style.width = "100%";
    gl.domElement.style.height = "100%";
    const controller = new AbortController();
    abort = () => controller.abort();
    const url = getAssetUrl({ ...options, fileName: "model.glb" });
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok)
      throw new Error(`Preview load failed: ${response.status}`);
    const bytes = await response.arrayBuffer();
    controller.signal.throwIfAborted();
    const gltf = await new GLTFLoader().parseAsync(
      bytes,
      new URL(".", url).href,
    );
    function releaseModel() {
      const textures = new Set<Texture>();
      const bitmaps = new Set<ImageBitmap>();
      for (const scene of gltf.scenes)
        scene.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          for (const material of materials) {
            for (const value of Object.values(material))
              if (value instanceof Texture) textures.add(value);
            material.dispose();
          }
        });
      for (const texture of textures) {
        if (texture.source.data instanceof ImageBitmap)
          bitmaps.add(texture.source.data);
        texture.dispose();
      }
      for (const bitmap of bitmaps) bitmap.close();
    }
    if (currentLoadId !== loadId) {
      releaseModel();
      return;
    }
    release = releaseModel;
    const model = gltf.scene;
    const bounds = new Box3().setFromObject(model);
    const nativeSize = bounds.getSize(new Vector3());
    const nativeScale = model.scale.clone();
    const nativePosition = model.position.clone();
    function fitModel(sizeM: Size) {
      model.scale
        .copy(nativeScale)
        .multiply(
          new Vector3(
            sizeM.width / Math.max(nativeSize.x, 0.0001),
            sizeM.height / Math.max(nativeSize.y, 0.0001),
            sizeM.depth / Math.max(nativeSize.z, 0.0001),
          ),
        );
      model.position.copy(nativePosition);
      bounds.setFromObject(model);
      model.position.sub(bounds.getCenter(new Vector3()));
    }
    fitModel(options.sizeM);
    const turntable = new Group();
    turntable.add(model);
    const scene = new Scene();
    scene.background = new Color(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim(),
    );
    const key = new DirectionalLight(0xffffff, 2);
    key.position.set(3, 4, 5);
    scene.environment = environment;
    scene.environmentIntensity = objectEnvironmentIntensity;
    scene.add(turntable, new AmbientLight(0xffffff, 1.5), key);
    const radiusM = bounds.getSize(new Vector3()).length() / 2;
    const distanceM = (radiusM / Math.sin(Math.PI / 8)) * 1.1;
    const camera = new PerspectiveCamera(
      45,
      1,
      distanceM / 100,
      distanceM * 100,
    );
    if (options.view.kind === "orbit") {
      resize = (sizeM) => {
        fitModel(sizeM);
        gl.render(scene, camera);
      };
      showOrbit({
        target: options.target,
        render: () => gl.render(scene, camera),
        camera,
        distanceM,
      });
      options.target.appendChild(gl.domElement);
      return;
    }
    resize = fitModel;
    camera.position.set(2, 1, 3).setLength(distanceM);
    camera.lookAt(0, 0, 0);
    const startedAtMs = performance.now();
    function draw(nowMs: number) {
      turntable.rotation.y =
        ((nowMs - startedAtMs) / 1000) * rotationRadPerSecond;
      gl.render(scene, camera);
      frameId = requestAnimationFrame(draw);
    }
    gl.render(scene, camera);
    options.target.appendChild(gl.domElement);
    frameId = requestAnimationFrame(draw);
  }

  function showOrbit(options: {
    target: HTMLElement;
    render: () => void;
    camera: PerspectiveCamera;
    distanceM: number;
  }) {
    const orbit = {
      azimuthRad: Math.atan2(2, 3),
      elevationRad: Math.asin(1 / Math.sqrt(14)),
      distanceM: options.distanceM,
    };
    let drag: { pointerId: number; xPx: number; yPx: number } | undefined;
    function update() {
      const { azimuthRad, elevationRad, distanceM } = orbit;
      options.camera.position.set(
        distanceM * Math.cos(elevationRad) * Math.sin(azimuthRad),
        distanceM * Math.sin(elevationRad),
        distanceM * Math.cos(elevationRad) * Math.cos(azimuthRad),
      );
      options.camera.lookAt(0, 0, 0);
      options.render();
    }
    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      event.preventDefault();
      options.target.setPointerCapture(event.pointerId);
      drag = {
        pointerId: event.pointerId,
        xPx: event.clientX,
        yPx: event.clientY,
      };
    }
    function handlePointerMove(event: PointerEvent) {
      if (drag?.pointerId !== event.pointerId) return;
      orbit.azimuthRad -= (event.clientX - drag.xPx) * orbitRadPerPx;
      orbit.elevationRad = Math.max(
        -maxElevationRad,
        Math.min(
          maxElevationRad,
          orbit.elevationRad + (event.clientY - drag.yPx) * orbitRadPerPx,
        ),
      );
      drag = { ...drag, xPx: event.clientX, yPx: event.clientY };
      update();
    }
    function handlePointerUp(event: PointerEvent) {
      if (drag?.pointerId === event.pointerId) drag = undefined;
    }
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      orbit.distanceM = Math.max(
        options.distanceM / 2,
        Math.min(
          options.distanceM * 3,
          orbit.distanceM *
            Math.exp(
              event.deltaY *
                (event.deltaMode === WheelEvent.DOM_DELTA_LINE
                  ? wheelLinePx
                  : 1) *
                zoomPerWheelPx,
            ),
        ),
      );
      update();
    }
    const node = options.target;
    node.addEventListener("pointerdown", handlePointerDown);
    node.addEventListener("pointermove", handlePointerMove);
    node.addEventListener("pointerup", handlePointerUp);
    node.addEventListener("pointercancel", handlePointerUp);
    node.addEventListener("wheel", handleWheel, { passive: false });
    detach = () => {
      node.removeEventListener("pointerdown", handlePointerDown);
      node.removeEventListener("pointermove", handlePointerMove);
      node.removeEventListener("pointerup", handlePointerUp);
      node.removeEventListener("pointercancel", handlePointerUp);
      node.removeEventListener("wheel", handleWheel);
    };
    update();
  }

  function start(options: Parameters<typeof load>[0]) {
    const pending = load(options);
    const currentLoadId = loadId;
    void pending.catch((error: unknown) => {
      if (currentLoadId === loadId && target === options.target) {
        console.warn("Model preview unavailable", error);
        stop(options.target);
      }
    });
  }

  function stopForReducedMotion() {
    if (reducedMotion.matches && target && view?.kind === "turntable")
      stop(target);
  }
  reducedMotion.addEventListener("change", stopForReducedMotion);

  function update(options: { target: HTMLElement; sizeM: Size }) {
    if (target === options.target) resize?.(options.sizeM);
  }

  return {
    start,
    stop,
    update,
    dispose() {
      if (target) stop(target);
      reducedMotion.removeEventListener("change", stopForReducedMotion);
      renderer?.dispose();
      renderer?.forceContextLoss();
      environment.dispose();
    },
  };
}
