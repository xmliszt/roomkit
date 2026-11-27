import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { InventoryObject } from "@planner/shared/src/inventory/inventory-object-schema.ts";
import type { InventoryJob } from "@planner/shared/src/jobs/job-schema.ts";
import type { Photo } from "@planner/shared/src/photos/photo-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { PlacementSchema } from "@planner/shared/src/scene/placement-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { SizeSchema } from "@planner/shared/src/scene/size-schema.ts";
import { z } from "zod";
import { runPythonWorker } from "../python/run-python-worker.ts";
import { writeJson } from "../util/write-json.ts";

const MasksSchema = z.object({
  objects: z.array(
    z
      .object({
        objectId: IdSchema,
        views: z.array(
          z.object({ photoId: IdSchema, maskPath: z.string() }).passthrough(),
        ),
      })
      .passthrough(),
  ),
});

const MeasurementsSchema = z.object({
  objects: z.array(
    z.object({
      objectId: IdSchema,
      sizeM: SizeSchema,
      placement: PlacementSchema,
    }),
  ),
  failures: z
    .array(z.object({ objectId: IdSchema, message: z.string() }))
    .default([]),
});

export async function runInventoryMeasurement(options: {
  folder: string;
  jobId: string;
  objects: InventoryObject[];
  photos: Extract<Photo, { kind: "accepted" }>[];
  scenePath: string;
  room: Room;
  python: string;
  workersDir: string;
  weightsRoot: string;
  segmentationModel: string;
  processPath: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal: AbortSignal;
  onLine: (line: string) => void;
  onProgress: (patch: {
    stage: InventoryJob["stage"];
    progress: number;
  }) => void;
}) {
  const directory = join(
    options.folder,
    ".planner",
    "inventory",
    options.jobId,
  );
  mkdirSync(directory, { recursive: true });
  const photosPath = join(directory, "photos.json");
  writeJson({
    path: photosPath,
    value: { version: 1, photos: options.photos },
  });
  if (options.objects.length === 0) return { objects: [], failures: [] };
  const masksDir = join(directory, "masks");
  const segmented: z.infer<typeof MasksSchema>["objects"] = [];
  for (const [index, object] of options.objects.entries()) {
    options.signal.throwIfAborted();
    const views = object.views.map((view) => {
      const photo = options.photos.find(
        (photo) => photo.photoId === view.photoId,
      );
      if (!photo) throw new Error("Inventory photo is no longer available");
      return {
        photoId: view.photoId,
        path: join(options.folder, "photos", photo.uprightPath),
        box: [
          Math.floor((view.box[0] * photo.widthPx) / photo.visionWidthPx),
          Math.floor((view.box[1] * photo.heightPx) / photo.visionHeightPx),
          Math.ceil((view.box[2] * photo.widthPx) / photo.visionWidthPx),
          Math.ceil((view.box[3] * photo.heightPx) / photo.visionHeightPx),
        ],
      };
    });
    function progress(stage: InventoryJob["stage"]) {
      options.onProgress({
        stage,
        progress: 0.2 + (0.6 * index) / options.objects.length,
      });
    }
    progress("segmenting");
    const masks = MasksSchema.parse(
      await runPythonWorker({
        ...options,
        worker: "segment",
        input: {
          weightsDir: options.weightsRoot,
          outputDir: masksDir,
          model: options.segmentationModel,
          objects: [{ objectId: object.objectId, name: object.name, views }],
        },
        onProgress: () => progress("segmenting"),
      }),
    );
    if (
      masks.objects.length !== 1 ||
      masks.objects.at(0)?.objectId !== object.objectId
    )
      throw new Error("Segmentation returned a different object set");
    segmented.push(...masks.objects);
  }
  const masksPath = join(masksDir, "masks.json");
  writeJson({ path: masksPath, value: { objects: segmented } });
  options.onProgress({ stage: "measuring", progress: 0.8 });
  const measured = MeasurementsSchema.parse(
    await runPythonWorker({
      ...options,
      worker: "measure",
      input: {
        scenePath: options.scenePath,
        masksPath,
        photosPath,
        room: options.room,
        objects: options.objects,
        outputDir: directory,
      },
      onProgress: () =>
        options.onProgress({ stage: "measuring", progress: 0.8 }),
    }),
  );
  const entries = [...measured.objects, ...measured.failures];
  if (
    entries.length !== options.objects.length ||
    options.objects.some(
      (object) =>
        entries.filter((entry) => entry.objectId === object.objectId).length !==
        1,
    )
  )
    throw new Error("Measurement returned a different object set");
  if (
    measured.objects.some(
      (item) =>
        item.placement.kind !==
        options.objects.find((object) => object.objectId === item.objectId)
          ?.mount,
    )
  )
    throw new Error("Measurement returned a different mount");
  return measured;
}
