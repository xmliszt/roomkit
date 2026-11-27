import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import { type BufferGeometry, type Object3D, Vector3 } from "three";
import { getDimensionLine } from "../../room/get-dimension-line.ts";
import { getFloorDots } from "../../room/get-floor-dots.ts";
import { getWallSegments } from "../../room/get-wall-segments.ts";
import { getWallVisibility } from "../../room/get-wall-visibility.ts";
import { createSurfaceEnvironment } from "./create-surface-environment.ts";
import { createSurfaceGeometry } from "./create-surface-geometry.ts";
import { createSurfaceTextureCache } from "./create-surface-texture-cache.ts";
import { getWallEndExtensions } from "./get-wall-end-extensions.ts";
import { isCeilingVisible } from "./is-ceiling-visible.ts";
import { RoomSurface } from "./room-surface.tsx";
import { RoomWall } from "./room-wall.tsx";
import { useTokenColors } from "./use-token-colors.ts";

type Point = [number, number, number];

const edgeOpacity = 0.36;
const dotSpacingM = 0.5;
const maxFloorDots = 20_000;

type RoomShellProps = {
  labelsShown: boolean;
  walking: boolean;
  projectId: string;
  selectedSurfaceId: string | undefined;
  onSelectSurface: (surfaceId: string) => void;
  onClearSelection: () => void;
  room: Room;
  items: Item[];
  gridShown: boolean;
  labelRefs: RefObject<(HTMLElement | null)[]>;
};

export function RoomShell(props: RoomShellProps) {
  const tokens = useTokenColors();
  const dpr = useThree((state) => state.viewport.dpr);
  const walls = props.room.walls;
  const segments = useMemo(() => getWallSegments({ walls }), [walls]);
  const textureCache = useMemo(() => createSurfaceTextureCache(), []);
  const heightM = props.room.ceilingHeightM;
  const wallRefs = useRef<(Object3D | null)[]>([]);
  const cornerRefs = useRef<(Object3D | null)[]>([]);
  const dimensionRefs = useRef<(Object3D | null)[]>([]);
  const projected = useMemo(() => new Vector3(), []);

  const environment = useMemo(createSurfaceEnvironment, []);
  const ceilingRef = useRef<Object3D>(null);
  const floorGeometry = useMemo(
    () => createSurfaceGeometry({ kind: "floor", walls }),
    [walls],
  );
  useEffect(() => () => environment.dispose(), [environment]);
  useEffect(() => () => floorGeometry.dispose(), [floorGeometry]);
  const floorOutline: Point[] = [
    ...props.room.walls.map(
      (wall): Point => [wall.startM.x, 0.005, wall.startM.z],
    ),
    [
      props.room.walls[0]?.startM.x ?? 0,
      0.005,
      props.room.walls[0]?.startM.z ?? 0,
    ],
  ];
  function surface(options: {
    surfaceId: string;
    geometry: BufferGeometry;
    outline: Point[];
    shade?: number;
    outlineSegments?: boolean;
  }) {
    return (
      <RoomSurface
        projectId={props.projectId}
        room={props.room}
        surfaceId={options.surfaceId}
        geometry={options.geometry}
        outline={options.outline}
        outlineSegments={options.outlineSegments ?? false}
        shade={options.shade ?? 1}
        selected={props.selectedSurfaceId === options.surfaceId}
        onSelect={props.onSelectSurface}
        environment={environment}
        textureCache={textureCache}
        onClearSelection={props.onClearSelection}
      />
    );
  }

  const dots = useMemo(() => {
    const points = getFloorDots({
      room: { walls },
      spacingM: dotSpacingM,
      marginM: 0.1,
      maxDots: maxFloorDots,
    });
    return new Float32Array(
      points.flatMap((point) => [point.x, 0.002, point.z]),
    );
  }, [walls]);

  const dimensions = useMemo(
    () => segments.map((segment) => getDimensionLine({ segment })),
    [segments],
  );

  useFrame((state) => {
    const cameraM = state.camera.position;
    const { width, height } = state.size;
    if (ceilingRef.current)
      ceilingRef.current.visible = isCeilingVisible({
        room: props.room,
        cameraM,
      });
    const { hidden, drawn, cornerDrawn } = getWallVisibility({
      segments,
      cameraM,
    });
    segments.forEach((segment, index) => {
      const wall = wallRefs.current[index];
      const corner = cornerRefs.current[index];
      const dimension = dimensionRefs.current[index];
      const label = props.labelRefs.current[index];
      if (wall)
        wall.visible = props.walking
          ? segment.wall.kind !== "open"
          : drawn[index] === true;
      if (corner) corner.visible = props.walking || cornerDrawn[index] === true;
      if (dimension)
        dimension.visible = !props.walking && hidden[index] === true;
      const labelM = dimensions[index]?.labelM;
      if (label && labelM) {
        projected.set(labelM.x, labelM.y, labelM.z).project(state.camera);
        const isShown =
          !props.walking &&
          props.labelsShown &&
          hidden[index] === true &&
          projected.z < 1;
        label.style.display = isShown ? "block" : "none";
        label.style.transform = `translate(${((projected.x + 1) / 2) * width}px, ${((1 - projected.y) / 2) * height}px) translate(-50%, -50%)`;
      }
    });
  });

  return (
    <group>
      {surface({
        surfaceId: "floor",
        geometry: floorGeometry,
        outline: floorOutline,
      })}
      <group ref={ceilingRef} position-y={heightM}>
        {surface({
          surfaceId: "ceiling",
          geometry: floorGeometry,
          outline: floorOutline.map(([x, , z]) => [x, -0.005, z]),
        })}
      </group>
      <points visible={props.gridShown}>
        <bufferGeometry key={dots.length}>
          <bufferAttribute attach="attributes-position" args={[dots, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={tokens.ink}
          size={2 * dpr}
          sizeAttenuation={false}
          transparent
          opacity={0.3}
          depthWrite={false}
        />
      </points>
      {segments.map((segment, index) => {
        const dimension = dimensions[index];
        const extensions = getWallEndExtensions({
          segment,
          previous: segments[(index + segments.length - 1) % segments.length],
          next: segments[(index + 1) % segments.length],
        });
        return (
          <group key={segment.wall.id}>
            <RoomWall
              projectId={props.projectId}
              room={props.room}
              segment={segment}
              startExtensionM={extensions.startExtensionM}
              endExtensionM={extensions.endExtensionM}
              openings={props.items.filter(
                (item) =>
                  item.cutsOpening &&
                  item.placement.kind === "wall" &&
                  item.placement.wallId === segment.wall.id,
              )}
              selected={props.selectedSurfaceId === segment.wall.id}
              onSelect={props.onSelectSurface}
              onClearSelection={props.onClearSelection}
              environment={environment}
              textureCache={textureCache}
              wallRefs={wallRefs}
              cornerRefs={cornerRefs}
              index={index}
            />
            {dimension !== undefined && (
              <group
                ref={(node) => {
                  dimensionRefs.current[index] = node;
                }}
              >
                <Line
                  points={dimension.segments.flatMap(([a, b]): Point[] => [
                    [a.x, a.y, a.z],
                    [b.x, b.y, b.z],
                  ])}
                  segments
                  color={tokens.ink}
                  lineWidth={1}
                  transparent
                  opacity={edgeOpacity}
                />
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}
