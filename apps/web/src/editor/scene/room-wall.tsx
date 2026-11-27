import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { Line } from "@react-three/drei";
import {
  createContext,
  memo,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
} from "react";
import type { Object3D, Texture } from "three";
import type { WallSegment } from "../../room/wall-segment.ts";
import type { createSurfaceTextureCache } from "./create-surface-texture-cache.ts";
import { createWallGeometry } from "./create-wall-geometry.ts";
import { getWallSurfaceTransform } from "./get-wall-surface-transform.ts";
import { RoomSurface } from "./room-surface.tsx";
import { useTokenColors } from "./use-token-colors.ts";

type RoomWallProps = {
  projectId: string;
  room: Room;
  segment: WallSegment;
  startExtensionM: number;
  endExtensionM: number;
  openings: Item[];
  selected: boolean;
  onSelect: (surfaceId: string) => void;
  onClearSelection: () => void;
  environment: Texture;
  textureCache: ReturnType<typeof createSurfaceTextureCache>;
  wallRefs: RefObject<(Object3D | null)[]>;
  cornerRefs: RefObject<(Object3D | null)[]>;
  index: number;
};

const WallPresentationContext = createContext<RoomWallProps | undefined>(
  undefined,
);
type WallGeometryProps = Parameters<typeof createWallGeometry>[0];

export function RoomWall(props: RoomWallProps) {
  return (
    <WallPresentationContext.Provider value={props}>
      <MemoizedWallGeometry
        wallId={props.segment.wall.id}
        lengthM={props.segment.lengthM}
        heightM={props.room.ceilingHeightM}
        items={props.openings}
        startExtensionM={props.startExtensionM}
        endExtensionM={props.endExtensionM}
      />
    </WallPresentationContext.Provider>
  );
}

const MemoizedWallGeometry = memo(function WallGeometry(
  props: WallGeometryProps,
) {
  const wallGeometry = useMemo(() => createWallGeometry(props), [props]);
  useEffect(() => () => wallGeometry.geometry.dispose(), [wallGeometry]);
  return <WallPresentation wallGeometry={wallGeometry} />;
}, sameGeometry);

function WallPresentation(input: {
  wallGeometry: ReturnType<typeof createWallGeometry>;
}) {
  const wallGeometry = input.wallGeometry;
  const props = useContext(WallPresentationContext);
  const tokens = useTokenColors();
  if (!props) throw new Error("Missing wall presentation");
  const segment = props.segment;
  const transform = getWallSurfaceTransform({
    segment,
    heightM: props.room.ceilingHeightM,
  });
  function lines(points: [number, number, number][]) {
    return points.length > 0 ? (
      <Line
        points={points}
        segments
        color={tokens.ink}
        lineWidth={1}
        transparent
        opacity={0.36}
      />
    ) : null;
  }
  return (
    <group position={transform.position} rotation-y={transform.rotationY}>
      {lines(wallGeometry.baseOutline)}
      {segment.wall.kind !== "open" && (
        <group
          ref={(node) => {
            props.wallRefs.current[props.index] = node;
          }}
        >
          <RoomSurface
            projectId={props.projectId}
            room={props.room}
            surfaceId={segment.wall.id}
            geometry={wallGeometry.geometry}
            outline={wallGeometry.outline}
            outlineSegments
            shade={Math.max(0.95, 0.973 - 0.027 * segment.outward.z)}
            selected={props.selected}
            onSelect={props.onSelect}
            onClearSelection={props.onClearSelection}
            environment={props.environment}
            textureCache={props.textureCache}
          />
          {lines(wallGeometry.topOutline)}
        </group>
      )}
      <group
        ref={(node) => {
          props.cornerRefs.current[props.index] = node;
        }}
      >
        {lines(wallGeometry.startOutline)}
      </group>
    </group>
  );
}

function sameGeometry(previous: WallGeometryProps, next: WallGeometryProps) {
  return (
    previous.wallId === next.wallId &&
    previous.lengthM === next.lengthM &&
    previous.heightM === next.heightM &&
    previous.startExtensionM === next.startExtensionM &&
    previous.endExtensionM === next.endExtensionM &&
    previous.items.length === next.items.length &&
    previous.items.every((item, index) => {
      const other = next.items[index];
      return (
        other !== undefined &&
        item.sizeM.width === other.sizeM.width &&
        item.sizeM.height === other.sizeM.height &&
        item.placement.kind === "wall" &&
        other.placement.kind === "wall" &&
        item.placement.wallId === other.placement.wallId &&
        item.placement.alongM === other.placement.alongM &&
        item.placement.heightM === other.placement.heightM &&
        item.placement.rotationRad === other.placement.rotationRad
      );
    })
  );
}
