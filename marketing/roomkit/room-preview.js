import * as THREE from "three";
import { roomLighting } from "./room-lighting.js";
import { createRoomView, roomBounds } from "./room-scene.js";

const home = { azimuth: -2.31, elevation: 0.59, distance: 10.2 };
const orbitTargetHeight = 1;
const eyeHeight = 1.48;
const radiansPerMs = 0.000075;
const idleDelayMs = 650;
const orbitResumeMs = 480;
const hoverProbeIntervalMs = 120;
const minOrbitDistance = 1.35;
const maxOrbitDistance = 12.6;
const interiorTransitionDistance = 6;
const zoomPerPx = 0.0014;
const normal = new THREE.Vector3(0, 1, 0);

export async function mountRoomPreview(viewport, reducedMotion) {
  const {
    scene,
    camera,
    renderer,
    canvas,
    furniture,
    lamp,
    localLight,
    resize,
    setCutaway,
    updateShadows,
    loop,
  } = await createRoomView(viewport, { shadows: true });
  const orbit = { ...home };
  const movable = furniture.filter((part) => part.userData.movable);
  const floor = new THREE.Plane(normal, 0);
  const ray = new THREE.Raycaster();
  const cursor = new THREE.Vector2();
  const groundPoint = new THREE.Vector3();
  const selection = new THREE.BoxHelper(movable[0], "#1e50e6");
  const hoverOutline = new THREE.BoxHelper(movable[0], "#1e50e6");
  const bounds = new THREE.Box3();
  Object.assign(selection.material, { transparent: true, opacity: 0.78 });
  Object.assign(hoverOutline.material, { transparent: true, opacity: 0.38 });
  scene.add(selection, hoverOutline);
  let selected;
  let hovered;
  let isPointerInside = false;
  let nextHoverProbeMs = 0;
  let gesture;
  let previousFrame = 0;
  let idleSince = -Infinity;
  let stop;
  let isVisible = true;

  function draw(time, refreshHover = false) {
    const elapsed = Math.min(32, time - (previousFrame || time));
    previousFrame = time;
    const isOrbiting =
      !gesture && !reducedMotion.matches && time - idleSince > idleDelayMs;
    if (isOrbiting) {
      const speed = THREE.MathUtils.smoothstep(
        time - idleSince - idleDelayMs,
        0,
        orbitResumeMs,
      );
      orbit.azimuth += elapsed * radiansPerMs * speed;
    }
    const interiorBlend =
      1 -
      THREE.MathUtils.smoothstep(
        orbit.distance,
        minOrbitDistance,
        interiorTransitionDistance,
      );
    const orbitRadius = orbit.distance * Math.max(1, 1.2 / camera.aspect);
    const horizontalRadius = THREE.MathUtils.lerp(
      Math.cos(orbit.elevation) * orbitRadius,
      orbit.distance,
      interiorBlend,
    );
    camera.position.set(
      Math.sin(orbit.azimuth) * horizontalRadius,
      THREE.MathUtils.lerp(
        orbitTargetHeight + Math.sin(orbit.elevation) * orbitRadius,
        eyeHeight,
        interiorBlend,
      ),
      Math.cos(orbit.azimuth) * horizontalRadius,
    );
    const interiorTargetHeight =
      eyeHeight +
      horizontalRadius * Math.tan(home.elevation - orbit.elevation - 0.13);
    camera.lookAt(
      0,
      THREE.MathUtils.lerp(
        orbitTargetHeight,
        interiorTargetHeight,
        interiorBlend,
      ),
      0,
    );
    const fov = THREE.MathUtils.lerp(36, 58, interiorBlend);
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    const { x, y, z } = camera.position;
    const isInsideRoom =
      x > roomBounds.left + camera.near &&
      x < roomBounds.right - camera.near &&
      z > roomBounds.back + camera.near &&
      z < roomBounds.front - camera.near &&
      y < roomBounds.height - camera.near;
    const cutawayStrength =
      1 - THREE.MathUtils.smoothstep(interiorBlend, 0.5, 1);
    setCutaway(!isInsideRoom, cutawayStrength);
    if (
      isPointerInside &&
      (refreshHover || (isOrbiting && time >= nextHoverProbeMs))
    ) {
      camera.updateMatrixWorld();
      ray.setFromCamera(cursor, camera);
      hovered = hitItem();
      nextHoverProbeMs = time + hoverProbeIntervalMs;
    }
    selection.visible = Boolean(selected);
    hoverOutline.visible = Boolean(hovered && hovered !== selected);
    if (selected) selection.setFromObject(selected);
    if (hoverOutline.visible) hoverOutline.setFromObject(hovered);
    renderer.render(scene, camera);
  }

  function updateLoop() {
    stop?.();
    previousFrame = 0;
    if (!isVisible) return;
    if (!reducedMotion.matches) stop = loop(draw);
    draw(performance.now());
  }

  function project(event) {
    const rect = canvas.getBoundingClientRect();
    cursor.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    ray.setFromCamera(cursor, camera);
    return ray.ray.intersectPlane(floor, groundPoint);
  }

  function hitItem() {
    const hit = ray.intersectObjects(
      furniture.filter((item) => item.visible),
    )[0];
    let object = hit?.object;
    while (object && !furniture.includes(object)) object = object.parent;
    return movable.includes(object) || object === lamp ? object : undefined;
  }

  function limit(item) {
    bounds.setFromObject(item);
    item.position.x +=
      Math.max(0, roomBounds.left - bounds.min.x) -
      Math.max(0, bounds.max.x - roomBounds.right);
    item.position.z +=
      Math.max(0, roomBounds.back - bounds.min.z) -
      Math.max(0, bounds.max.z - roomBounds.front);
    updateShadows();
  }

  function turn(x, y) {
    orbit.azimuth += x;
    orbit.elevation = THREE.MathUtils.clamp(orbit.elevation + y, 0.2, 1.22);
  }

  function zoom(deltaPx) {
    const distance = THREE.MathUtils.clamp(
      orbit.distance * Math.exp(deltaPx * zoomPerPx),
      minOrbitDistance,
      maxOrbitDistance,
    );
    if (distance === orbit.distance) return;
    orbit.distance = distance;
    idleSince = performance.now();
    draw(idleSince, true);
  }

  function toggleLamp() {
    localLight.intensity = localLight.intensity
      ? 0
      : roomLighting.lamp.intensity;
  }

  canvas.tabIndex = 0;
  canvas.removeAttribute("aria-hidden");
  canvas.setAttribute("aria-label", viewport.dataset.controlsLabel);
  canvas.addEventListener(
    "wheel",
    (event) => {
      const { deltaMode, deltaY } = event;
      if (event.ctrlKey || !deltaY) return;
      event.preventDefault();
      if (gesture) return;
      let deltaPx = deltaY;
      if (deltaMode === WheelEvent.DOM_DELTA_LINE) deltaPx *= 16;
      else if (deltaMode === WheelEvent.DOM_DELTA_PAGE)
        deltaPx *= canvas.clientHeight;
      zoom(deltaPx);
    },
    { passive: false },
  );
  canvas.addEventListener("pointerdown", (event) => {
    if (gesture || event.button !== 0) return;
    const at = project(event);
    selected = hitItem();
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offset: at && selected ? selected.position.clone().sub(at) : undefined,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
    draw(performance.now());
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = project(event);
    if (!gesture) {
      isPointerInside = true;
      const item = hitItem();
      if (hovered === item) return;
      hovered = item;
      draw(performance.now());
      return;
    }
    if (gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    gesture.moved = true;
    if (selected && event.shiftKey) {
      selected.rotation.y += dx * 0.018;
      limit(selected);
    } else if (selected && point) {
      gesture.offset ??= selected.position.clone().sub(point);
      selected.position.x = point.x + gesture.offset.x;
      selected.position.z = point.z + gesture.offset.z;
      limit(selected);
    } else if (!selected) {
      turn(-dx * 0.008, dy * 0.008);
    }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    draw(performance.now());
  });

  canvas.addEventListener("pointerleave", () => {
    isPointerInside = false;
    hovered = undefined;
    if (!gesture) draw(performance.now());
  });
  canvas.addEventListener("pointerup", () => {
    if (gesture && !gesture.moved && selected === lamp) toggleLamp();
  });
  canvas.addEventListener("lostpointercapture", () => {
    gesture = undefined;
    idleSince = performance.now();
    draw(idleSince);
  });
  canvas.addEventListener("dblclick", () => {
    if (!selected || selected === lamp) return;
    selected.rotation.y += Math.PI / 12;
    limit(selected);
    draw(performance.now());
  });

  const direction = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  canvas.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === "+" || key === "=" || key === "-") {
      if (event.ctrlKey || event.metaKey || gesture) return;
      event.preventDefault();
      zoom(key === "-" ? 100 : -100);
      return;
    }
    if (key === "escape") selected = undefined;
    else if (key === " ")
      selected = movable[(movable.indexOf(selected) + 1) % movable.length];
    else if (key === "l") toggleLamp();
    else if (key === "r" && selected) {
      selected.rotation.y += Math.PI / 12;
      limit(selected);
    } else if (Object.hasOwn(direction, event.key)) {
      const [x, z] = direction[event.key];
      if (selected && !event.altKey) {
        selected.position.x += x * 0.12;
        selected.position.z += z * 0.12;
        limit(selected);
      } else turn(x * 0.12, z * -0.08);
    } else return;
    event.preventDefault();
    draw(performance.now());
  });

  viewport.prepend(canvas);
  resize();
  updateLoop();
  viewport.dataset.ready = "";
  new ResizeObserver(() => {
    if (resize()) draw(performance.now());
  }).observe(viewport);
  new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting;
    updateLoop();
  }).observe(viewport);
  reducedMotion.addEventListener("change", updateLoop);
  canvas.addEventListener("webglcontextlost", () => {
    stop?.();
    delete viewport.dataset.ready;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    updateShadows();
    viewport.dataset.ready = "";
    updateLoop();
  });
}
