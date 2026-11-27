import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Light } from "@planner/shared/src/scene/light-schema.ts";
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  type PointerEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type Matrix4, Plane, Raycaster, Vector2, Vector3 } from "three";
import { useMessages } from "../../../i18n/use-messages.ts";
import { getItemBox } from "../../../items/get-item-box.ts";
import type { BulbField } from "../../bulb-field.ts";
import { getLightColor } from "./get-light-color.ts";
import { getLightEmitterFromPosition } from "./get-light-emitter-from-position.ts";
import { getLightEmitterWorldPosition } from "./get-light-emitter-world-position.ts";
import { isLightEmitterVisible } from "./is-light-emitter-visible.ts";
import { LightEmitterRegistryContext } from "./light-emitter-registry-context.ts";

type BulbMarkerProps = {
  bulbField: BulbField | undefined;
  item: Item & { light: Light };
  onPreview: (emitter: Light["emitter"] | undefined) => void;
  onCommit: (emitter: Light["emitter"]) => void;
};

type Drag = {
  startEmitter: Light["emitter"];
  pointerId: number;
  plane: Plane;
  inverse: Matrix4;
  startM: Vector3;
  hitM: Vector3;
  startPx: Vector2;
  upPx: Vector2;
  vertical: boolean;
  emitter: Light["emitter"];
};

export function BulbMarker(props: BulbMarkerProps) {
  const t = useMessages();
  const { camera, gl, size, invalidate } = useThree();
  const labelLayer = Number(
    getComputedStyle(gl.domElement).getPropertyValue("--layer-label"),
  );
  const emitters = useContext(LightEmitterRegistryContext);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const guidesRef = useRef<SVGPathElement>(null);
  const coneRef = useRef<SVGPathElement>(null);
  const axisRef = useRef<SVGPathElement>(null);
  const dragRef = useRef<Drag>(undefined);
  const previewRef = useRef(props.onPreview);
  previewRef.current = props.onPreview;
  const [isDragging, setIsDragging] = useState(false);
  const [scratch] = useState(() => ({
    projected: new Vector3(),
    bulb: new Vector3(),
    floor: new Vector3(),
    sideX: new Vector3(),
    sideZ: new Vector3(),
    direction: new Vector3(),
    centre: new Vector3(),
    tangent: new Vector3(),
    other: new Vector3(),
    up: new Vector3(0, 1, 0),
    right: new Vector3(1, 0, 0),
    arrow: new Vector3(),
    end: new Vector3(),
    raycaster: new Raycaster(),
    pointer: new Vector2(),
    hit: new Vector3(),
    world: new Vector3(),
    delta: new Vector2(),
  }));
  const ringRef = useRef<{ key: string; points: Vector3[] }>({
    key: "",
    points: [],
  });
  const box = getItemBox({
    placementKind: props.item.placement.kind,
    sizeM: props.item.sizeM,
  });
  const light = props.item.light;

  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = undefined;
    if (buttonRef.current?.hasPointerCapture(drag.pointerId))
      buttonRef.current.releasePointerCapture(drag.pointerId);
    setIsDragging(false);
    previewRef.current(undefined);
    invalidate();
  }, [invalidate]);

  useEffect(() => {
    axisRef.current?.setAttribute("data-field", props.bulbField ?? "");
    invalidate();
  }, [props.bulbField, invalidate]);

  useEffect(() => {
    if (!isDragging) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelDrag();
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isDragging, cancelDrag]);

  useEffect(
    () => () => {
      dragRef.current = undefined;
      previewRef.current(undefined);
    },
    [],
  );

  useFrame(() => {
    const source = emitters[props.item.id];
    const button = buttonRef.current;
    if (!button) return;
    const visible = isLightEmitterVisible(source);
    if (!visible || !source?.parent) {
      button.style.display = "none";
      guidesRef.current?.parentElement?.setAttribute("visibility", "hidden");
      cancelDrag();
      return;
    }
    source.updateWorldMatrix(true, false);
    const matrix = source.parent.matrixWorld;
    const bulb = scratch.bulb.copy(source.position);
    function screen(point: Vector3) {
      const projected = scratch.projected
        .copy(point)
        .applyMatrix4(matrix)
        .project(camera);
      return {
        x: ((projected.x + 1) * size.width) / 2,
        y: ((1 - projected.y) * size.height) / 2,
        z: projected.z,
      };
    }
    function path(points: Vector3[]) {
      return points
        .map((point, index) => {
          const at = screen(point);
          return `${index === 0 ? "M" : "L"}${at.x},${at.y}`;
        })
        .join(" ");
    }
    const at = screen(bulb);
    button.style.display = at.z > -1 && at.z < 1 ? "grid" : "none";
    button.style.left = `${at.x}px`;
    button.style.top = `${at.y}px`;
    const axis = props.bulbField;
    const enlarged = axis !== undefined || dragRef.current !== undefined;
    button.dataset.highlighted = String(enlarged);
    const dot = button.firstElementChild;
    if (dot instanceof HTMLElement)
      dot.style.width = dot.style.height = enlarged ? "18px" : "12px";
    guidesRef.current?.parentElement?.setAttribute(
      "visibility",
      at.z > -1 && at.z < 1 ? "visible" : "hidden",
    );
    const sideX =
      bulb.x - box.x.min < box.x.max - bulb.x ? box.x.min : box.x.max;
    const sideZ =
      bulb.z - box.z.min < box.z.max - bulb.z ? box.z.min : box.z.max;
    guidesRef.current?.setAttribute(
      "d",
      [
        path([bulb, scratch.floor.set(bulb.x, box.y.min, bulb.z)]),
        path([bulb, scratch.sideX.set(sideX, bulb.y, bulb.z)]),
        path([bulb, scratch.sideZ.set(bulb.x, bulb.y, sideZ)]),
      ].join(" "),
    );
    const direction = light.beam
      ? scratch.direction
          .set(
            props.item.mirrored
              ? -light.beam.direction.x
              : light.beam.direction.x,
            light.beam.direction.y,
            light.beam.direction.z,
          )
          .normalize()
      : scratch.direction.set(0, -1, 0);
    const ringKey = `${bulb.x}:${bulb.y}:${bulb.z}:${direction.x}:${direction.y}:${direction.z}:${light.beam?.angleDeg}`;
    if (light.beam && ringRef.current.key !== ringKey) {
      const centre = scratch.centre.copy(bulb).addScaledVector(direction, 0.25);
      const tangent = scratch.tangent
        .crossVectors(
          direction,
          Math.abs(direction.y) > 0.9 ? scratch.right : scratch.up,
        )
        .normalize();
      const other = scratch.other.crossVectors(direction, tangent);
      const radius = Math.tan((light.beam.angleDeg * Math.PI) / 360) * 0.25;
      const ring = Array.from({ length: 33 }, (_, index) =>
        centre
          .clone()
          .addScaledVector(tangent, Math.cos((index * Math.PI) / 16) * radius)
          .addScaledVector(other, Math.sin((index * Math.PI) / 16) * radius),
      );
      ringRef.current = { key: ringKey, points: ring };
    }
    if (light.beam) {
      const ring = ringRef.current.points;
      coneRef.current?.setAttribute(
        "d",
        [
          path(ring),
          ...[0, 8, 16, 24].flatMap((index) => {
            const point = ring.at(index);
            return point ? [path([bulb, point])] : [];
          }),
        ].join(" "),
      );
    } else coneRef.current?.setAttribute("d", "");
    const arrow =
      axis === "x"
        ? scratch.arrow.set(props.item.mirrored ? -1 : 1, 0, 0)
        : axis === "y" || dragRef.current?.vertical
          ? scratch.arrow.set(0, 1, 0)
          : axis === "z"
            ? scratch.arrow.set(0, 0, 1)
            : direction;
    const end = screen(scratch.end.copy(bulb).addScaledVector(arrow, 0.15));
    const dx = end.x - at.x;
    const dy = end.y - at.y;
    const length = Math.hypot(dx, dy) || 1;
    axisRef.current?.setAttribute(
      "d",
      axis !== undefined || dragRef.current?.vertical
        ? `M${at.x},${at.y} L${end.x},${end.y} M${end.x - (dx / length) * 7 - (dy / length) * 4},${end.y - (dy / length) * 7 + (dx / length) * 4} L${end.x},${end.y} L${end.x - (dx / length) * 7 + (dy / length) * 4},${end.y - (dy / length) * 7 - (dx / length) * 4}`
        : "",
    );
  });

  function ray(event: PointerEvent) {
    const rect = gl.domElement.getBoundingClientRect();
    const raycaster = scratch.raycaster;
    raycaster.setFromCamera(
      scratch.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      ),
      camera,
    );
    return raycaster.ray;
  }

  function begin(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const source = emitters[props.item.id];
    if (!source?.parent || !isLightEmitterVisible(source)) return;
    source.updateWorldMatrix(true, false);
    const startM = getLightEmitterWorldPosition({
      emitter: light.emitter,
      box,
      mirrored: props.item.mirrored ?? false,
      matrixWorld: source.parent.matrixWorld,
    });
    const plane = new Plane().setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new Vector3()),
      startM,
    );
    const hitM = ray(event).intersectPlane(plane, new Vector3());
    if (!hitM) return;
    const from = startM.clone().project(camera);
    const up = startM
      .clone()
      .add(new Vector3(0, 1, 0))
      .project(camera);
    dragRef.current = {
      startEmitter: light.emitter,
      pointerId: event.pointerId,
      plane,
      inverse: source.parent.matrixWorld.clone().invert(),
      startM,
      hitM,
      startPx: new Vector2(event.clientX, event.clientY),
      upPx: new Vector2(
        ((up.x - from.x) * size.width) / 2,
        ((from.y - up.y) * size.height) / 2,
      ),
      vertical: event.shiftKey,
      emitter: light.emitter,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    invalidate();
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!isLightEmitterVisible(emitters[props.item.id])) {
      cancelDrag();
      return;
    }
    const hit = ray(event).intersectPlane(drag.plane, scratch.hit);
    if (!hit) return;
    const world = scratch.world.copy(drag.startM);
    if (drag.vertical) {
      const delta = scratch.delta
        .set(event.clientX, event.clientY)
        .sub(drag.startPx);
      world.y += delta.dot(drag.upPx) / Math.max(1, drag.upPx.lengthSq());
    } else world.add(hit.sub(drag.hitM));
    const emitter = getLightEmitterFromPosition({
      positionM: world.applyMatrix4(drag.inverse),
      box,
      mirrored: props.item.mirrored ?? false,
    });
    drag.emitter = drag.vertical
      ? { ...drag.startEmitter, y: emitter.y }
      : emitter;
    props.onPreview(drag.emitter);
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const canCommit =
      event.type === "pointerup" &&
      isLightEmitterVisible(emitters[props.item.id]);
    cancelDrag();
    if (canCommit) props.onCommit(drag.emitter);
  }

  return (
    <Html
      fullscreen
      onOcclude={() => undefined}
      zIndexRange={[labelLayer, labelLayer]}
      calculatePosition={(_, __, viewport) => [
        viewport.width / 2,
        viewport.height / 2,
      ]}
      style={{ pointerEvents: "none" }}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full overflow-hidden"
        style={{ opacity: light.on ? 1 : 0.4 }}
      >
        <g fill="none" stroke="var(--accent)" strokeWidth="1">
          <path ref={guidesRef} strokeDasharray="3 3" />
          <path ref={coneRef} />
          <path ref={axisRef} data-testid="bulb-axis" strokeWidth="1.5" />
        </g>
      </svg>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("editor.bulb-marker.move-bulb")}
        title={t(
          "editor.bulb-marker.drag-to-move-bulb-shift-drag-vertically-edit",
        )}
        data-testid="bulb-marker"
        className="pointer-events-auto absolute hidden size-6 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-accent"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onClick={(event) => event.stopPropagation()}
      >
        <span
          className="block rounded-full border border-accent"
          style={{
            width: 12,
            height: 12,
            background: getLightColor(light.temperatureK).getStyle(),
            opacity: light.on ? 1 : 0.4,
          }}
        />
      </button>
    </Html>
  );
}
