import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GenerationSpecSchema } from "@planner/shared/src/generation/generation-spec-schema.ts";
import { ClientCommandSchema } from "@planner/shared/src/protocol/client-command-schema.ts";
import sharp from "sharp";
import { expect, test } from "vitest";
import { GenerationRecordSchema } from "./generation-record-schema.ts";
import { getSourcePhotoIds } from "./get-source-photo-ids.ts";
import { mergeSourcePhotos } from "./merge-source-photos.ts";
import { prepareGenerationFolder } from "./prepare-generation-folder.ts";
import { readRegenerationSource } from "./read-regeneration-source.ts";

function record() {
  const now = new Date().toISOString();
  return GenerationRecordSchema.parse({
    job: {
      id: "original-job",
      kind: "generation",
      projectId: "00000000-0000-4000-8000-000000000000",
      itemId: "table",
      stage: "ready",
      progress: 1,
      createdAt: now,
      updatedAt: now,
    },
    item: {
      id: "table",
      name: "Table",
      model: { kind: "asset", assetId: "original" },
      sizeM: { width: 1, height: 1, depth: 1 },
      placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
      locked: false,
    },
    source: { kind: "photo", photoId: "photo" },
    prompt: "Build a table",
    held: false,
    attempt: 0,
    assetId: "original",
  });
}

test.each([
  { kind: "photo", photoId: "photo" },
  {
    kind: "web",
    imageUrl: "https://unreachable.invalid/photo.jpg",
    sourceUrl: "https://unreachable.invalid",
  },
  { kind: "shape", parentAssetId: "parent" },
])(
  "regenerates an imported $kind asset from saved images without its original source",
  async (source) => {
    const root = mkdtempSync(join(tmpdir(), "planner-regeneration-"));
    try {
      const original = record();
      original.source = GenerationRecordSchema.shape.source.parse(source);
      const sourceFolder = join(root, "assets", "original", "source");
      mkdirSync(join(sourceFolder, "photos"), { recursive: true });
      const photoBytes = Buffer.from("saved image bytes");
      writeFileSync(join(sourceFolder, "photos", "reference.png"), photoBytes);
      writeFileSync(
        join(sourceFolder, "job.json"),
        JSON.stringify({
          reference: source,
          photos: ["photos/reference.png"],
          masks: [],
        }),
      );
      const recovered = readRegenerationSource({
        projectFolder: root,
        item: original.item,
        previous: undefined,
      });
      expect(recovered.source).toEqual(source);
      const regenerated = {
        ...original,
        notes: "Three oval legs",
        source: recovered.source,
        regeneration: { sourcePath: recovered.sourcePath },
      };
      const folder = join(root, "new-job");
      await prepareGenerationFolder({
        record: regenerated,
        projectFolder: root,
        folder,
        blenderDir: resolve("blender"),
        allowedHosts: [],
      });
      expect(readFileSync(join(folder, "photos", "reference.png"))).toEqual(
        photoBytes,
      );
      expect(
        JSON.parse(readFileSync(join(folder, "job.json"), "utf8")),
      ).toMatchObject({ notes: "Three oval legs", reference: source });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("refuses sources missing from both the job records and the asset", () => {
  const root = mkdtempSync(join(tmpdir(), "planner-regeneration-"));
  try {
    expect(() =>
      readRegenerationSource({
        projectFolder: root,
        item: record().item,
        previous: undefined,
      }),
    ).toThrow("source is unavailable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("regeneration commands allow empty notes and reject oversized corrections and unknown fields", () => {
  for (const type of [
    "generation.start",
    "generation.regenerate",
    "agent.asset.regenerate",
  ]) {
    const command = {
      type,
      projectId: record().job.projectId,
      itemId: "table",
      ...(type.startsWith("agent.")
        ? { turnId: "00000000-0000-4000-8000-000000000000" }
        : {}),
    };
    for (const notes of [undefined, "", "x".repeat(1000)])
      expect(ClientCommandSchema.safeParse({ ...command, notes }).success).toBe(
        true,
      );
    expect(
      ClientCommandSchema.safeParse({ ...command, notes: "x".repeat(1001) })
        .success,
    ).toBe(false);
    expect(
      ClientCommandSchema.safeParse({ ...command, source: "other" }).success,
    ).toBe(false);
  }
});

test("kept alternatives rebuild inventory crops and use the item's current name and size", async () => {
  const root = mkdtempSync(join(tmpdir(), "planner-regeneration-"));
  try {
    const original = record();
    original.source = {
      kind: "inventory",
      inventoryJobId: "inventory",
      object: {
        objectId: "table",
        name: "Old table",
        mount: "floor",
        bestPhotoId: "photo",
        views: [
          { photoId: "photo", box: [2, 3, 8, 9], visibility: "mostly-visible" },
        ],
      },
    };
    const item = {
      ...original.item,
      name: "Renamed table",
      model: {
        kind: "asset",
        assetId: "alternative",
      } satisfies typeof original.item.model,
      sizeM: { width: 2, height: 3, depth: 4 },
    };
    const sourceFolder = join(root, "assets", "alternative", "source");
    mkdirSync(sourceFolder, { recursive: true });
    writeFileSync(
      join(sourceFolder, "job.json"),
      JSON.stringify({
        reference: original.source,
        photos: ["photos/full.png"],
        masks: ["masks/full.png"],
      }),
    );
    const uprightFolder = join(root, "photos", "upright");
    const maskFolder = join(
      root,
      ".planner",
      "inventory",
      "inventory",
      "masks",
    );
    mkdirSync(uprightFolder, { recursive: true });
    mkdirSync(maskFolder, { recursive: true });
    await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#ff0000" },
    })
      .jpeg()
      .toFile(join(uprightFolder, "photo.jpg"));
    await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#ffffff" },
    })
      .png()
      .toFile(join(maskFolder, "mask.png"));
    writeFileSync(
      join(root, "photos", "photos.json"),
      JSON.stringify({
        version: 1,
        photos: [
          {
            photoId: "photo",
            origin: "capture",
            sourceFileName: "photo.jpg",
            widthPx: 10,
            heightPx: 10,
            orientation: 1,
            blurScore: 100,
            kind: "accepted",
            uprightPath: "upright/photo.jpg",
            visionPath: "vision/photo.jpg",
            visionWidthPx: 10,
            visionHeightPx: 10,
          },
        ],
      }),
    );
    writeFileSync(
      join(maskFolder, "masks.json"),
      JSON.stringify({
        objects: [
          {
            objectId: "table",
            views: [{ photoId: "photo", maskPath: "mask.png" }],
          },
        ],
      }),
    );
    const recovered = readRegenerationSource({
      projectFolder: root,
      item,
      previous: original,
      isAlternative: true,
    });
    expect(recovered).toMatchObject({
      source: original.source,
      sourcePath: undefined,
      prompt: item.name,
    });
    const folder = join(root, "new-job");
    await prepareGenerationFolder({
      record: {
        ...original,
        item,
        source: recovered.source,
        regeneration: { sourcePath: recovered.sourcePath },
      },
      projectFolder: root,
      folder,
      blenderDir: resolve("blender"),
      allowedHosts: [],
    });
    for (const path of ["photos/photo.jpg", "masks/photo.png"])
      expect(await sharp(join(folder, path)).metadata()).toMatchObject({
        width: 6,
        height: 6,
      });
    expect(
      JSON.parse(readFileSync(join(folder, "job.json"), "utf8")),
    ).toMatchObject({
      sizeM: item.sizeM,
      sizeSource: "the item's current size",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.each([false, true])(
  "colour variants use original parent sources with archive available: %s",
  async (hasArchive) => {
    const root = mkdtempSync(join(tmpdir(), "planner-regeneration-"));
    try {
      const parent = record();
      const variant = record();
      variant.source = {
        kind: "color",
        parentAssetId: parent.assetId,
        color: "#123456",
        strength: 0.6,
        referenceLuma: 0.5,
        nativeSizeM: parent.item.sizeM,
      };
      variant.assetId = "variant";
      variant.item.model = { kind: "asset", assetId: variant.assetId };
      variant.notes = "Earlier corrections must not survive";
      if (hasArchive) {
        const sourceFolder = join(root, "assets", parent.assetId, "source");
        mkdirSync(join(sourceFolder, "photos"), { recursive: true });
        writeFileSync(
          join(sourceFolder, "job.json"),
          JSON.stringify({
            reference: parent.source,
            photos: ["photos/reference.png"],
            masks: [],
            notes: "Other earlier corrections",
          }),
        );
        writeFileSync(
          join(sourceFolder, "photos", "reference.png"),
          "saved parent image",
        );
      }
      const recovered = readRegenerationSource({
        projectFolder: root,
        item: variant.item,
        previous: variant,
        records: [parent, variant],
      });
      expect(recovered).toMatchObject({
        source: parent.source,
        colorNotes: "Use colour #123456 at strength 0.6.",
        sourcePath: hasArchive ? "assets/original/source" : undefined,
      });
      expect(recovered).not.toHaveProperty("notes");
      if (hasArchive) {
        const folder = join(root, "new-job");
        await prepareGenerationFolder({
          record: {
            ...variant,
            notes: "Oval legs",
            colorNotes: recovered.colorNotes,
            source: recovered.source,
            regeneration: { sourcePath: recovered.sourcePath },
          },
          projectFolder: root,
          folder,
          blenderDir: resolve("blender"),
          allowedHosts: [],
        });
        expect(
          readFileSync(join(folder, "photos", "reference.png"), "utf8"),
        ).toBe("saved parent image");
        expect(
          JSON.parse(readFileSync(join(folder, "job.json"), "utf8")),
        ).toMatchObject({
          notes: "Oval legs\nUse colour #123456 at strength 0.6.",
          colorNotes: recovered.colorNotes,
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("imported regenerated colour variants retain colour without earlier user notes", () => {
  const root = mkdtempSync(join(tmpdir(), "planner-regeneration-"));
  try {
    const original = record();
    const sourceFolder = join(root, "assets", "original", "source");
    mkdirSync(sourceFolder, { recursive: true });
    writeFileSync(
      join(sourceFolder, "job.json"),
      JSON.stringify({
        reference: original.source,
        colorNotes: "Use colour #123456 at strength 0.6.",
        notes: "Earlier corrections",
      }),
    );
    const recovered = readRegenerationSource({
      projectFolder: root,
      item: original.item,
      previous: undefined,
    });
    expect(recovered.colorNotes).toBe("Use colour #123456 at strength 0.6.");
    expect(recovered).not.toHaveProperty("notes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an imported colour variant resolves its parent archive without job records", () => {
  const root = mkdtempSync(join(tmpdir(), "planner-regeneration-"));
  try {
    const original = record();
    const parentFolder = join(root, "assets", "parent", "source");
    const variantFolder = join(root, "assets", "original", "source");
    mkdirSync(parentFolder, { recursive: true });
    mkdirSync(variantFolder, { recursive: true });
    writeFileSync(
      join(parentFolder, "job.json"),
      JSON.stringify({ reference: original.source }),
    );
    writeFileSync(
      join(variantFolder, "job.json"),
      JSON.stringify({
        reference: {
          kind: "color",
          parentAssetId: "parent",
          color: "#654321",
          strength: 1,
          referenceLuma: 0.5,
          nativeSizeM: original.item.sizeM,
        },
      }),
    );
    const recovered = readRegenerationSource({
      projectFolder: root,
      item: original.item,
      previous: undefined,
    });
    expect(recovered).toMatchObject({
      source: original.source,
      sourcePath: "assets/parent/source",
      colorNotes: "Use colour #654321 at strength 1.",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a colour variant of a kept alternative uses the parent's generation source without copying alternative images", () => {
  const root = mkdtempSync(join(tmpdir(), "planner-regeneration-"));
  try {
    const parent = record();
    const alternative = GenerationRecordSchema.parse({
      ...parent,
      assetId: "alternative",
      source: { kind: "photo", photoId: "wrong-photo" },
      job: {
        ...parent.job,
        kind: "generation-alternative",
        method: "trellis2",
        id: "alternative-job",
      },
    });
    const variant = record();
    variant.assetId = "variant";
    variant.item.model = { kind: "asset", assetId: variant.assetId };
    variant.source = {
      kind: "color",
      parentAssetId: alternative.assetId,
      color: "#123456",
      strength: 1,
      referenceLuma: 0.5,
      nativeSizeM: parent.item.sizeM,
    };
    variant.job.itemId = "variant";
    const sourceFolder = join(root, "assets", alternative.assetId, "source");
    mkdirSync(sourceFolder, { recursive: true });
    writeFileSync(
      join(sourceFolder, "job.json"),
      JSON.stringify({ reference: alternative.source }),
    );
    const recovered = readRegenerationSource({
      projectFolder: root,
      item: variant.item,
      previous: variant,
      records: [parent, alternative, variant],
    });
    expect(recovered).toMatchObject({
      source: parent.source,
      sourcePath: undefined,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses a cycle in colour variant parents", () => {
  const root = mkdtempSync(join(tmpdir(), "planner-regeneration-"));
  try {
    const original = record();
    original.source = {
      kind: "color",
      parentAssetId: "original",
      color: "#123456",
      strength: 1,
      referenceLuma: 0.5,
      nativeSizeM: original.item.sizeM,
    };
    const sourceFolder = join(root, "assets", "original", "source");
    mkdirSync(sourceFolder, { recursive: true });
    writeFileSync(
      join(sourceFolder, "job.json"),
      JSON.stringify({ reference: original.source }),
    );
    expect(() =>
      readRegenerationSource({
        projectFolder: root,
        item: original.item,
        previous: original,
      }),
    ).toThrow("sources contain a cycle");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const method of ["trellis2", "sam3d"]) {
  for (const kind of ["alternative", "color"]) {
    test(`imported ${kind} with ${method} provenance refuses full-frame inventory images when the original crops cannot be rebuilt`, async () => {
      const root = mkdtempSync(join(tmpdir(), "planner-regeneration-"));
      try {
        const original = record();
        const source = GenerationRecordSchema.shape.source.parse({
          kind: "inventory",
          inventoryJobId: "inventory",
          object: {
            objectId: "table",
            name: "Old table",
            mount: "floor",
            bestPhotoId: "photo",
            views: [
              {
                photoId: "photo",
                box: [2, 3, 8, 9],
                visibility: "mostly-visible",
              },
            ],
          },
        });
        const sourceFolder = join(root, "assets", "alternative", "source");
        mkdirSync(join(sourceFolder, "photos"), { recursive: true });
        mkdirSync(join(sourceFolder, "masks"));
        writeFileSync(
          join(root, "assets", "alternative", "meta.json"),
          JSON.stringify({
            id: "alternative",
            kind: "generated",
            nativeSizeM: original.item.sizeM,
            mount: "floor",
            triangleCount: 12,
            hasColorMask: false,
            provenance: { method, sourcePhotoIds: ["photo"] },
          }),
        );
        writeFileSync(
          join(sourceFolder, "job.json"),
          JSON.stringify({
            reference: source,
            photos: ["photos/full.png"],
            masks: ["masks/full.png"],
          }),
        );
        writeFileSync(
          join(sourceFolder, "photos", "full.png"),
          "full-frame photo",
        );
        writeFileSync(
          join(sourceFolder, "masks", "full.png"),
          "full-frame mask",
        );
        const item = {
          ...original.item,
          name: "Renamed table",
          model: {
            kind: "asset",
            assetId: kind === "color" ? "color" : "alternative",
          } satisfies typeof original.item.model,
        };
        if (kind === "color") {
          const colorFolder = join(root, "assets", "color", "source");
          mkdirSync(colorFolder, { recursive: true });
          writeFileSync(
            join(colorFolder, "job.json"),
            JSON.stringify({
              reference: {
                kind: "color",
                parentAssetId: "alternative",
                color: "#123456",
                strength: 1,
                referenceLuma: 0.5,
                nativeSizeM: item.sizeM,
              },
            }),
          );
        }
        const recovered = readRegenerationSource({
          projectFolder: root,
          item,
          previous: undefined,
        });
        expect(recovered).toMatchObject({
          source,
          sourcePath: undefined,
          prompt: item.name,
        });
        await expect(
          prepareGenerationFolder({
            record: {
              ...original,
              item,
              source: recovered.source,
              regeneration: { sourcePath: recovered.sourcePath },
            },
            projectFolder: root,
            folder: join(root, "new-job"),
            blenderDir: resolve("blender"),
            allowedHosts: [],
          }),
        ).rejects.toThrow(/ENOENT/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}

test("photos added to a room-inventory object follow its saved crops without replacing them", async () => {
  const root = mkdtempSync(join(tmpdir(), "planner-regeneration-"));
  try {
    const original = record();
    original.source = {
      kind: "inventory",
      inventoryJobId: "inventory",
      object: {
        objectId: "table",
        name: "Table",
        mount: "floor",
        bestPhotoId: "photo",
        views: [
          { photoId: "photo", box: [2, 3, 8, 9], visibility: "mostly-visible" },
        ],
      },
    };
    const sourceFolder = join(root, "assets", "original", "source");
    mkdirSync(join(sourceFolder, "photos"), { recursive: true });
    mkdirSync(join(sourceFolder, "masks"), { recursive: true });
    writeFileSync(join(sourceFolder, "photos", "photo.jpg"), "saved crop");
    writeFileSync(join(sourceFolder, "masks", "photo.png"), "saved mask");
    writeFileSync(
      join(sourceFolder, "job.json"),
      JSON.stringify({
        reference: original.source,
        photos: ["photos/photo.jpg"],
        masks: ["masks/photo.png"],
      }),
    );
    mkdirSync(join(root, "photos", "upright"), { recursive: true });
    await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#00ff00" },
    })
      .jpeg()
      .toFile(join(root, "photos", "upright", "chat.jpg"));
    writeFileSync(
      join(root, "photos", "photos.json"),
      JSON.stringify({
        version: 1,
        photos: [
          {
            photoId: "chat",
            origin: "chat",
            sourceFileName: "chat.jpg",
            widthPx: 10,
            heightPx: 10,
            orientation: 1,
            blurScore: 100,
            kind: "accepted",
            uprightPath: "upright/chat.jpg",
            visionPath: "vision/chat.jpg",
            visionWidthPx: 10,
            visionHeightPx: 10,
          },
        ],
      }),
    );
    const recovered = readRegenerationSource({
      projectFolder: root,
      item: original.item,
      previous: original,
    });
    const source = mergeSourcePhotos({
      source: recovered.source,
      photoIds: ["photo", "chat"],
      primaryPhotoId: undefined,
    });
    expect(source).toEqual({ ...original.source, extraPhotoIds: ["chat"] });
    expect(() =>
      mergeSourcePhotos({
        source: recovered.source,
        photoIds: ["chat"],
        primaryPhotoId: "chat",
      }),
    ).toThrow("keeps its best view");
    const folder = join(root, "new-job");
    await prepareGenerationFolder({
      record: {
        ...original,
        source,
        regeneration: { sourcePath: recovered.sourcePath },
      },
      projectFolder: root,
      folder,
      blenderDir: resolve("blender"),
      allowedHosts: [],
    });
    expect(readFileSync(join(folder, "photos", "photo.jpg"), "utf8")).toBe(
      "saved crop",
    );
    expect(
      JSON.parse(readFileSync(join(folder, "job.json"), "utf8")),
    ).toMatchObject({
      photos: ["photos/photo.jpg", "photos/chat.jpg"],
      masks: ["masks/photo.png"],
      bestPhoto: "photos/photo.jpg",
      reference: { extraPhotoIds: ["chat"] },
    });
    expect(
      await sharp(join(folder, "photos", "chat.jpg")).metadata(),
    ).toMatchObject({ width: 10, height: 10 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("old photo references parse unchanged and extra photo IDs must be unique and exclude the primary", () => {
  const base = {
    name: "Chair",
    sizeM: { width: 1, height: 1, depth: 1 },
    placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
    prompt: "Chair",
  };
  expect(record().source).toEqual({ kind: "photo", photoId: "photo" });
  expect(
    getSourcePhotoIds({
      kind: "photo",
      photoId: "photo",
      extraPhotoIds: ["photo", "side"],
    }),
  ).toEqual(["photo", "side"]);
  expect(
    GenerationSpecSchema.parse({
      ...base,
      reference: { kind: "photo", photoId: "photo" },
    }).reference,
  ).toEqual({ kind: "photo", photoId: "photo" });
  for (const extraPhotoIds of [
    ["photo"],
    ["side", "side"],
    Array.from({ length: 12 }, (_, index) => `view-${index}`),
  ])
    expect(
      GenerationSpecSchema.safeParse({
        ...base,
        reference: { kind: "photo", photoId: "photo", extraPhotoIds },
      }).success,
    ).toBe(false);
  expect(
    ClientCommandSchema.safeParse({
      type: "generation.start",
      projectId: record().job.projectId,
      itemId: "table",
      photoIds: ["photo"],
    }).success,
  ).toBe(false);
  for (const photoIds of [[], ["a", "a"]])
    expect(
      ClientCommandSchema.safeParse({
        type: "generation.regenerate",
        projectId: record().job.projectId,
        itemId: "table",
        photoIds,
      }).success,
    ).toBe(false);
  expect(
    ClientCommandSchema.safeParse({
      type: "generation.regenerate",
      projectId: record().job.projectId,
      itemId: "table",
      photoIds: ["a", "b"],
      primaryPhotoId: "b",
    }).success,
  ).toBe(true);
});

test("a photo source skips added photos that are no longer in the project", async () => {
  const root = mkdtempSync(join(tmpdir(), "planner-regeneration-"));
  try {
    mkdirSync(join(root, "photos", "upright"), { recursive: true });
    await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#0000ff" },
    })
      .jpeg()
      .toFile(join(root, "photos", "upright", "new.jpg"));
    writeFileSync(
      join(root, "photos", "photos.json"),
      JSON.stringify({
        version: 1,
        photos: [
          {
            photoId: "new",
            origin: "chat",
            sourceFileName: "new.jpg",
            widthPx: 10,
            heightPx: 10,
            orientation: 1,
            blurScore: 100,
            kind: "accepted",
            uprightPath: "upright/new.jpg",
            visionPath: "vision/new.jpg",
            visionWidthPx: 10,
            visionHeightPx: 10,
          },
        ],
      }),
    );
    const folder = join(root, "new-job");
    await prepareGenerationFolder({
      record: {
        ...record(),
        source: { kind: "photo", photoId: "new", extraPhotoIds: ["photo"] },
      },
      projectFolder: root,
      folder,
      blenderDir: resolve("blender"),
      allowedHosts: [],
    });
    expect(
      JSON.parse(readFileSync(join(folder, "job.json"), "utf8")).photos,
    ).toEqual(["photos/new.jpg"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
