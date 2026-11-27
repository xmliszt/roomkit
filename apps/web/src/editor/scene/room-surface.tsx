import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import {
  BackSide,
  type BufferGeometry,
  Color,
  FrontSide,
  type Object3D,
  type Texture,
} from "three";
import type { createSurfaceTextureCache } from "./create-surface-texture-cache.ts";
import { getSurfaceColor } from "./get-surface-color.ts";
import { SurfaceFill } from "./surface-fill.tsx";
import { useTokenColors } from "./use-token-colors.ts";

type RoomSurfaceProps = {
  projectId: string;
  textureCache: ReturnType<typeof createSurfaceTextureCache>;
  onClearSelection: () => void;
  room: Room;
  surfaceId: string;
  geometry: BufferGeometry;
  outline: [number, number, number][];
  outlineSegments?: boolean;
  shade: number;
  selected: boolean;
  environment: Texture;
  onSelect: (surfaceId: string) => void;
};

export function RoomSurface(props: RoomSurfaceProps) {
  const tokens = useTokenColors();
  const [hovered, setHovered] = useState(false);
  const pressedRef = useRef(false);
  useEffect(() => {
    function resetPress() {
      pressedRef.current = false;
    }
    window.addEventListener("pointerdown", resetPress, true);
    return () => window.removeEventListener("pointerdown", resetPress, true);
  }, []);
  const stored = Object.hasOwn(props.room.surfaces, props.surfaceId)
    ? props.room.surfaces[props.surfaceId]
    : undefined;
  function visible(object: Object3D): boolean {
    return object.visible && (!object.parent || visible(object.parent));
  }
  function select(event: ThreeEvent<MouseEvent>) {
    const pressed = pressedRef.current;
    if (!pressed || event.delta > 3 || !visible(event.object)) return;
    event.stopPropagation();
    props.onSelect(props.surfaceId);
  }
  function clear(event: ThreeEvent<MouseEvent>) {
    if (!pressedRef.current || event.delta > 3 || !visible(event.object))
      return;
    event.stopPropagation();
    props.onClearSelection();
  }
  return (
    <group>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Three.js meshes render in a canvas; Room panel buttons provide keyboard selection. */}
      <mesh
        receiveShadow
        onClick={clear}
        onDoubleClick={select}
        geometry={props.geometry}
        onPointerDown={(event) => {
          if (visible(event.object)) pressedRef.current = true;
        }}
        onPointerOver={(event) => {
          if (!visible(event.object)) return;
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <SurfaceFill
          projectId={props.projectId}
          textureCache={props.textureCache}
          uDirection={
            props.surfaceId === "floor" || props.surfaceId === "ceiling"
              ? 1
              : -1
          }
          color={new Color(
            getSurfaceColor({
              room: props.room,
              surfaceId: props.surfaceId,
            }),
          )
            .multiplyScalar(props.shade)
            .getStyle()}
          material={stored?.material}
          environment={props.environment}
          side={props.surfaceId === "ceiling" ? BackSide : FrontSide}
        />
      </mesh>
      {(props.selected || hovered) && props.outline.length > 0 && (
        <Line
          points={props.outline}
          segments={props.outlineSegments ?? false}
          color={props.selected ? tokens.accent : tokens.ink}
          transparent
          opacity={props.selected ? 1 : 0.36}
          lineWidth={1}
          raycast={() => {}}
        />
      )}
    </group>
  );
}
