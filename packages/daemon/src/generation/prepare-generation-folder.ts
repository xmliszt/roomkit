import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { safeGet } from "../links/safe-get.ts";
import { readPhotos } from "../photos/read-photos.ts";
import { writeJson } from "../util/write-json.ts";
import { copySavedGenerationSources } from "./copy-saved-generation-sources.ts";
import type { GenerationRecord } from "./generation-record-schema.ts";
import { jobFilePath } from "./job-file-path.ts";

export async function prepareGenerationFolder(options: {
  record: GenerationRecord;
  projectFolder: string;
  folder: string;
  blenderDir: string;
  allowedHosts: string[];
}) {
  mkdirSync(options.folder, { recursive: true });
  for (const directory of ["photos", "lib", "masks"])
    mkdirSync(join(options.folder, directory), { recursive: true });
  copyFileSync(
    join(options.blenderDir, "procedural", "modeler_lib.py"),
    join(options.folder, "lib", "modeler_lib.py"),
  );
  copyFileSync(
    join(options.blenderDir, "glb_io.py"),
    join(options.folder, "lib", "glb_io.py"),
  );
  const source = options.record.source;
  const projectPhotos = readPhotos(options.projectFolder);
  function findPhoto(photoId: string) {
    const photo = projectPhotos.find((photo) => photo.photoId === photoId);
    return photo?.kind === "accepted" ? photo : undefined;
  }
  function photoPath(photoId: string) {
    const photo = findPhoto(photoId);
    if (!photo) throw new Error(`Reference photo ${photoId} is unavailable`);
    return {
      photo,
      path: jobFilePath({
        folder: options.projectFolder,
        path: join("photos", photo.uprightPath),
      }),
    };
  }
  async function addWholePhotos(input: { photos: string[]; masks: string[] }) {
    if (options.record.job.kind === "generation-alternative") return input;
    const added = (
      source.kind === "photo" || source.kind === "inventory"
        ? (source.extraPhotoIds ?? [])
        : []
    ).filter(
      (photoId) =>
        findPhoto(photoId) && !input.photos.includes(`photos/${photoId}.jpg`),
    );
    for (const photoId of added) {
      const name = `photos/${photoId}.jpg`;
      await sharp(photoPath(photoId).path)
        .jpeg()
        .toFile(join(options.folder, name));
      input.photos.push(name);
    }
    return input;
  }
  const saved =
    source.kind === "photo" && findPhoto(source.photoId)
      ? undefined
      : copySavedGenerationSources({
          sourcePath: options.record.regeneration?.sourcePath,
          projectFolder: options.projectFolder,
          folder: options.folder,
        });
  if (saved) return finish(await addWholePhotos(saved));
  const photos: string[] = [];
  const masks: string[] = [];
  switch (source.kind) {
    case "photo": {
      const name = `photos/${source.photoId}.jpg`;
      await sharp(photoPath(source.photoId).path)
        .jpeg()
        .toFile(join(options.folder, name));
      photos.push(name);
      break;
    }
    case "web": {
      const result = await safeGet({
        url: source.imageUrl,
        allowedHosts: options.allowedHosts,
        maxBytes: 20_000_000,
        timeoutMs: 15000,
        isTruncationAllowed: false,
      });
      if (!result.contentType?.startsWith("image/"))
        throw new Error("Reference URL did not return an image");
      await sharp(result.body)
        .rotate()
        .jpeg()
        .toFile(join(options.folder, "photos", "reference.jpg"));
      photos.push("photos/reference.jpg");
      break;
    }
    case "inventory": {
      const masksPath = jobFilePath({
        folder: options.projectFolder,
        path: join(
          ".planner",
          "inventory",
          source.inventoryJobId,
          "masks",
          "masks.json",
        ),
      });
      const manifest = z
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
        .parse(JSON.parse(readFileSync(masksPath, "utf8")));
      const objectMasks = manifest.objects.find(
        (object) => object.objectId === source.object.objectId,
      );
      if (!objectMasks) throw new Error("Inventory object has no masks");
      const views = source.object.views.toSorted(
        (a, b) =>
          Number(b.photoId === source.object.bestPhotoId) -
          Number(a.photoId === source.object.bestPhotoId),
      );
      for (const view of views) {
        const { photo, path } = photoPath(view.photoId);
        const left = Math.floor(
          (view.box[0] * photo.widthPx) / photo.visionWidthPx,
        );
        const top = Math.floor(
          (view.box[1] * photo.heightPx) / photo.visionHeightPx,
        );
        const right = Math.ceil(
          (view.box[2] * photo.widthPx) / photo.visionWidthPx,
        );
        const bottom = Math.ceil(
          (view.box[3] * photo.heightPx) / photo.visionHeightPx,
        );
        const crop = { left, top, width: right - left, height: bottom - top };
        const mask = objectMasks.views.find(
          (entry) => entry.photoId === view.photoId,
        );
        if (!mask)
          throw new Error(`Inventory mask is missing for ${view.photoId}`);
        const maskPath = jobFilePath({
          folder: options.projectFolder,
          path: join(dirname(masksPath), mask.maskPath),
        });
        const metadata = await sharp(maskPath).metadata();
        if (
          metadata.width !== photo.widthPx ||
          metadata.height !== photo.heightPx
        )
          throw new Error(
            "Inventory mask dimensions differ from the upright photo",
          );
        const name = `photos/${view.photoId}.jpg`;
        const maskName = `masks/${view.photoId}.png`;
        const image = sharp(path);
        const maskImage = sharp(maskPath);
        if (options.record.job.kind !== "generation-alternative") {
          image.extract(crop);
          maskImage.extract(crop);
        }
        await image.jpeg().toFile(join(options.folder, name));
        await maskImage.png().toFile(join(options.folder, maskName));
        photos.push(name);
        masks.push(maskName);
      }
      break;
    }
    case "shape":
      copyFileSync(
        jobFilePath({
          folder: options.projectFolder,
          path: join("assets", source.parentAssetId, "thumb.png"),
        }),
        join(options.folder, "photos", "reference.png"),
      );
      photos.push("photos/reference.png");
      break;
    case "color":
      break;
    default: {
      const exhaustive: never = source;
      throw new Error(String(exhaustive));
    }
  }
  return finish(await addWholePhotos({ photos, masks }));

  function finish(input: { photos: string[]; masks: string[] }) {
    writeJson({
      path: join(options.folder, "job.json"),
      value: {
        reference: options.record.source,
        notes: [options.record.notes, options.record.colorNotes]
          .filter(Boolean)
          .join("\n"),
        colorNotes: options.record.colorNotes,
        name: options.record.item.name,
        mount: options.record.item.placement.kind,
        sizeM: options.record.item.sizeM,
        sizeSource:
          source.kind === "inventory"
            ? options.record.regeneration
              ? "the item's current size"
              : "measured from the room inventory"
            : "requested size",
        photos: input.photos,
        masks: input.masks,
        bestPhoto: input.photos.at(0),
        boxInBestPhoto: [0, 0, 1, 1],
        output: "raw.glb",
        helperLibrary: "lib/modeler_lib.py",
        commands: {
          blender: "blender_run({path: 'model.py'})",
          preview: "modeler_preview({azimuthDeg: 30, elevationDeg: 20})",
        },
      },
    });
    return input.photos;
  }
}
