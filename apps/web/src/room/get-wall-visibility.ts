import { isWallHidden } from "./is-wall-hidden.ts";
import type { WallSegment } from "./wall-segment.ts";

/** Return, per wall, whether the camera is outside it (`hidden`), whether its surface is drawn (`drawn`: not hidden and not `open`), and whether the corner at its start is drawn (`cornerDrawn`: this wall or the previous one is drawn). */
export function getWallVisibility(options: {
  segments: WallSegment[];
  cameraM: { x: number; z: number };
}) {
  const { segments, cameraM } = options;
  const hidden = segments.map((segment) => isWallHidden({ segment, cameraM }));
  const drawn = segments.map(
    (segment, index) => hidden[index] === false && segment.wall.kind !== "open",
  );
  const cornerDrawn = drawn.map(
    (isDrawn, index) =>
      isDrawn || drawn[(index + drawn.length - 1) % drawn.length] === true,
  );
  return { hidden, drawn, cornerDrawn };
}
