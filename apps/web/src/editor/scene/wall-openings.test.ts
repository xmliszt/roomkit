import { readFileSync } from "node:fs";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { SizeSchema } from "@planner/shared/src/scene/size-schema.ts";
import { Euler, Vector3 } from "three";
import { expect, test } from "vitest";
import { z } from "zod";
import { getWallSegments } from "../../room/get-wall-segments.ts";
import { getItemRenderLayout } from "./get-item-render-layout.ts";
import { wallThicknessM } from "./wall-thickness-m.ts";

const project = ProjectSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../../../../scripts/a15/project.json", import.meta.url),
      "utf8",
    ),
  ),
);
const assets = z
  .array(
    z.object({
      assetId: z.string(),
      nativeSizeM: SizeSchema,
      min: z.tuple([z.number(), z.number(), z.number()]),
      max: z.tuple([z.number(), z.number(), z.number()]),
    }),
  )
  .parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../../../scripts/a15/asset-bounds.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
const segments = getWallSegments(project.scene.room);

for (const original of project.scene.items) {
  test.each([false, true])(
    `${original.name}: fixture asset bounds with cutsOpening=%s`,
    (cutsOpening) => {
      const item = { ...original, cutsOpening };
      const layout = getItemRenderLayout({
        item,
        segments,
        ceilingHeightM: project.scene.room.ceilingHeightM,
      });
      const placement = item.placement;
      if (!layout || placement.kind !== "wall" || item.model.kind !== "asset")
        throw new Error("Missing wall asset");
      const assetId = item.model.assetId;
      const asset = assets.find((entry) => entry.assetId === assetId);
      const segment = segments.find(
        (entry) => entry.wall.id === placement.wallId,
      );
      if (!asset || !segment)
        throw new Error("Missing fixture asset bounds or wall");
      const scale = new Vector3(
        layout.sizeM.width / asset.nativeSizeM.width,
        layout.sizeM.height / asset.nativeSizeM.height,
        layout.sizeM.depth / asset.nativeSizeM.depth,
      );
      const rotation = new Euler(
        0,
        layout.frame.yawRad,
        layout.frame.rollRad,
        "YXZ",
      );
      const position = new Vector3(
        layout.frame.positionM.x,
        layout.frame.positionM.y,
        layout.frame.positionM.z,
      );
      const faces = [asset.min[2], asset.max[2]].map((z) =>
        [asset.min[0], asset.max[0]].flatMap((x) =>
          [asset.min[1], asset.max[1]].map((y) => {
            const point = new Vector3(x, y, z)
              .multiply(scale)
              .applyEuler(rotation)
              .add(position);
            return (
              (point.x - segment.startM.x) * segment.outward.x +
              (point.z - segment.startM.z) * segment.outward.z
            );
          }),
        ),
      );
      const back = faces.at(0);
      if (!back) throw new Error("Missing rendered back face");
      for (const distanceM of back) {
        expect(distanceM).toBeCloseTo(
          cutsOpening ? (wallThicknessM + layout.sizeM.depth) / 2 : 0,
          6,
        );
      }
      if (cutsOpening) {
        expect(Math.min(...faces.flat())).toBeGreaterThanOrEqual(-1e-6);
        expect(Math.max(...faces.flat())).toBeLessThanOrEqual(
          wallThicknessM + 1e-6,
        );
        expect(layout.sizeM.depth).toBeLessThanOrEqual(wallThicknessM);
      }
      expect(item.sizeM).toEqual(original.sizeM);
    },
  );
}
