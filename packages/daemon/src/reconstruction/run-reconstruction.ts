import { copyFileSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import type { ReconstructionJob } from "@planner/shared/src/jobs/job-schema.ts";
import { PhotoSchema } from "@planner/shared/src/photos/photo-schema.ts";
import type { ScaleSource } from "@planner/shared/src/reconstruction/scale-source-schema.ts";
import { z } from "zod";
import { readPhotos } from "../photos/read-photos.ts";
import { runPythonWorker } from "../python/run-python-worker.ts";
import { writeJson } from "../util/write-json.ts";
import { CoverageSchema, ReconstructedRoomSchema } from "./worker-results.ts";

export async function runReconstruction(options: {
  folder: string;
  jobId: string;
  photoIds: string[];
  sources: ScaleSource[];
  python: string;
  workersDir: string;
  weightsRoot: string;
  processPath: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal: AbortSignal;
  segmentationModel: string;
  ensureProject: () => void;
  onArtifacts: (artifacts: {
    scenePath: string;
    camerasPath: string;
    pointsPath?: string;
  }) => void;
  onLine: (line: string) => void;
  onProgress: (patch: {
    stage: ReconstructionJob["stage"];
    progress: number;
  }) => void;
}) {
  const intakeDir = join(
    options.folder,
    ".planner",
    "reconstruction",
    options.jobId,
    "intake",
  );
  const reconDir = join(options.folder, "recon");
  const photos = readPhotos(options.folder).filter(
    (photo) =>
      options.photoIds.includes(photo.photoId) && photo.origin === "capture",
  );
  if (photos.length !== options.photoIds.length)
    throw new Error("Capture photos are no longer available");
  async function worker(input: {
    worker: Parameters<typeof runPythonWorker>[0]["worker"];
    request: unknown;
    stage: ReconstructionJob["stage"];
    base: number;
    span: number;
  }) {
    options.onProgress({ stage: input.stage, progress: input.base });
    return runPythonWorker({
      ...options,
      worker: input.worker,
      input: input.request,
      onProgress(frame) {
        options.ensureProject();
        if (frame.stage === "layout")
          options.onProgress({ stage: "layout", progress: 0.75 });
        else if (frame.progress !== undefined)
          options.onProgress({
            stage:
              input.worker === "reconstruct" && frame.progress >= 0.75
                ? "layout"
                : input.stage,
            progress: input.base + frame.progress * input.span,
          });
      },
    });
  }
  const intake = z.object({ photos: z.array(z.unknown()) }).parse(
    await worker({
      worker: "intake",
      stage: "intake",
      base: 0,
      span: 0.15,
      request: {
        photos: photos.map((photo) => ({
          photoId: photo.photoId,
          path: join(options.folder, "photos", photo.sourceFileName),
        })),
        outputDir: intakeDir,
      },
    }),
  );
  options.ensureProject();
  const acceptedRecords = intake.photos.map((photo) =>
    PhotoSchema.parse({
      ...z.record(z.string(), z.unknown()).parse(photo),
      origin: "capture",
    }),
  );
  if (
    acceptedRecords.length !== photos.length ||
    new Set(acceptedRecords.map((photo) => photo.photoId)).size !==
      photos.length ||
    acceptedRecords.some(
      (photo) =>
        !photos.some(
          (original) =>
            original.photoId === photo.photoId &&
            original.sourceFileName === photo.sourceFileName,
        ),
    )
  )
    throw new Error("Intake returned a different photo set");
  for (const photo of acceptedRecords) {
    if (photo.kind !== "accepted") continue;
    for (const relative of [photo.uprightPath, photo.visionPath])
      copyFileSync(
        join(intakeDir, relative),
        join(options.folder, "photos", relative),
      );
  }
  const latest = readPhotos(options.folder);
  writeJson({
    path: join(options.folder, "photos", "photos.json"),
    value: {
      version: 1,
      photos: latest.map((photo) =>
        photo.origin === "capture"
          ? (acceptedRecords.find(
              (result) => result.photoId === photo.photoId,
            ) ?? photo)
          : photo,
      ),
    },
  });
  if (acceptedRecords.filter((photo) => photo.kind === "accepted").length < 2)
    throw new Error("At least two capture photos must pass blur rejection");
  const scaleSources: unknown[] = [];
  for (const [index, source] of options.sources.entries()) {
    switch (source.kind) {
      case "measurement":
        scaleSources.push(source);
        break;
      case "distance":
        scaleSources.push({
          ...source,
          points: source.points.map((point) => [point.x, point.y, point.z]),
        });
        break;
      case "furniture": {
        const photo = acceptedRecords.find(
          (photo) => photo.photoId === source.photoId,
        );
        if (photo?.kind !== "accepted")
          throw new Error("The scale photo failed blur rejection");
        const objectId = `scale-${index}`;
        const outputDir = join(
          options.folder,
          ".planner",
          "reconstruction",
          options.jobId,
          "masks",
        );
        const masks = z
          .object({
            objects: z.array(
              z.object({
                objectId: z.string(),
                views: z.array(
                  z.object({ photoId: z.string(), maskPath: z.string() }),
                ),
              }),
            ),
          })
          .parse(
            await worker({
              worker: "segment",
              stage: "geometry",
              base: 0.15,
              span: 0.05,
              request: {
                weightsDir: options.weightsRoot,
                outputDir,
                model: options.segmentationModel,
                objects: [
                  {
                    objectId,
                    name: source.label ?? "scale object",
                    views: [
                      {
                        photoId: photo.photoId,
                        path: join(intakeDir, photo.uprightPath),
                        box: source.box,
                      },
                    ],
                  },
                ],
              },
            }),
          );
        const view = masks.objects
          .find((object) => object.objectId === objectId)
          ?.views.find((view) => view.photoId === source.photoId);
        if (!view) throw new Error("Segmentation returned no scale mask");
        const maskPath = resolve(outputDir, view.maskPath);
        if (!maskPath.startsWith(`${resolve(outputDir)}${sep}`))
          throw new Error("Scale mask is outside the job folder");
        const { box: _box, direction, ...measured } = source;
        scaleSources.push({
          ...measured,
          maskPath,
          ...(direction
            ? { direction: [direction.x, direction.y, direction.z] }
            : {}),
        });
        break;
      }
      default: {
        const unreachable: never = source;
        throw new Error(String(unreachable));
      }
    }
  }
  const room = ReconstructedRoomSchema.parse(
    await worker({
      worker: "reconstruct",
      stage: "geometry",
      base: 0.2,
      span: 0.6,
      request: {
        photosPath: join(intakeDir, "photos.json"),
        weightsDir: options.weightsRoot,
        outputDir: reconDir,
        scaleSources,
      },
    }),
  );
  options.ensureProject();
  const saved = ReconstructedRoomSchema.parse(
    JSON.parse(readFileSync(join(reconDir, "room.json"), "utf8")),
  );
  if (JSON.stringify(saved) !== JSON.stringify(room))
    throw new Error("Reconstruction result differs from room.json");
  const artifacts = z
    .object({
      scenePath: z.string().min(1),
      camerasPath: z.string().min(1),
      pointsPath: z.string().min(1).optional(),
    })
    .parse(room);
  function artifactPath(path: string) {
    const resolved = realpathSync(resolve(reconDir, path));
    if (
      !resolved.startsWith(`${realpathSync(reconDir)}${sep}`) ||
      !statSync(resolved).isFile()
    )
      throw new Error(
        "Reconstruction artifact is outside the reconstruction folder or not a file",
      );
    return resolved;
  }
  const pointsPath = artifacts.pointsPath
    ? artifactPath(artifacts.pointsPath)
    : undefined;
  if (pointsPath && statSync(pointsPath).size !== 8000 * 6 * 4)
    throw new Error("Invalid reconstruction preview size");
  options.onArtifacts({
    scenePath: artifactPath(artifacts.scenePath),
    camerasPath: artifactPath(artifacts.camerasPath),
    ...(pointsPath ? { pointsPath } : {}),
  });
  const coverage = CoverageSchema.parse(
    await worker({
      worker: "coverage",
      stage: "coverage",
      base: 0.8,
      span: 0.15,
      request: { reconDir },
    }),
  );
  options.ensureProject();
  const blocks: ChatBlock[] = coverage.captureRequests.map((request) => {
    const wall = room.walls.find((wall) => wall.id === request.surfaceId);
    if (!wall && request.surfaceId !== "floor")
      throw new Error("Coverage names an unknown surface");
    return {
      kind: "capture-request",
      wallId: request.surfaceId,
      standM: request.standAtM,
      lookAtM: {
        x: request.standAtM.x + request.lookDirection.x,
        z: request.standAtM.z + request.lookDirection.z,
      },
      text: wall
        ? `Photograph wall ${wall.id} near x ${wall.startM.x.toFixed(2)}, z ${wall.startM.z.toFixed(2)} (${request.reason}). Stand at the marked point and face the wall.`
        : "Photograph the floor from the marked point, looking down.",
    };
  });
  if (room.scale.disagreements.length)
    blocks.push({
      kind: "text",
      markdown: `Scale sources differ by more than 5%: ${room.scale.disagreements.join(", ")}. Check these measurements.`,
    });
  if (room.scale.weak)
    blocks.push({
      kind: "text",
      markdown:
        "The room uses the model's scale. Check width, depth and ceiling height in the room panel.",
    });
  return { room, blocks };
}
