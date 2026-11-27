import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import { expect, it } from "vitest";
import { writeJson } from "../../packages/daemon/src/util/write-json.ts";
import { replayDesignerTurn } from "../../scripts/demo/replay-designer-turn.ts";

const SAVED_PHOTO = "00000000-0000-4000-8000-0000000000a1";
const OTHER_PHOTO = "00000000-0000-4000-8000-0000000000a2";
const REPLAY_PHOTO = "00000000-0000-4000-8000-0000000000b1";
const time = "2026-11-24T11:50:48.086Z";
const spec = {
  name: "Table lamp",
  prompt: "A lamp from the photo",
  sizeM: { width: 0.16, height: 0.232, depth: 0.16 },
  placement: {
    kind: "floor",
    xM: -0.2,
    zM: 0.95,
    elevationM: 0.306,
    rotationRad: 0,
  } satisfies Placement,
};

function writePhotos(options: {
  folder: string;
  photos: { photoId: string; bytes: string }[];
}) {
  mkdirSync(options.folder, { recursive: true });
  for (const photo of options.photos)
    writeFileSync(join(options.folder, `${photo.photoId}.png`), photo.bytes);
  writeJson({
    path: join(options.folder, "photos.json"),
    value: {
      version: 1,
      photos: options.photos.map((photo) => ({
        photoId: photo.photoId,
        origin: "chat",
        sourceFileName: `${photo.photoId}.png`,
        widthPx: 10,
        heightPx: 10,
        orientation: 1,
        blurScore: 100,
        kind: "accepted",
        uprightPath: `upright/${photo.photoId}.jpg`,
        visionPath: `vision/${photo.photoId}.jpg`,
        visionWidthPx: 10,
        visionHeightPx: 10,
      })),
    },
  });
}

function imageMessage(options: { id: string; photoId: string }) {
  return {
    id: options.id,
    author: { kind: "user" },
    blocks: [
      {
        kind: "image",
        photoId: options.photoId,
        fileName: `${options.photoId}.png`,
        sizeBytes: 4,
      },
      { kind: "text", markdown: "add this" },
    ],
    status: "done",
    createdAt: time,
  };
}

function designerReply(options: { id: string; photoId: string; text: string }) {
  return {
    id: options.id,
    author: { kind: "agent", role: "designer" },
    blocks: [
      {
        kind: "tool",
        toolCallId: `${options.id}-read`,
        name: "Read",
        summary: "",
        status: "done",
        arguments: { file_path: `/saved/${options.photoId}.jpg` },
      },
      {
        kind: "tool",
        toolCallId: `${options.id}-generate`,
        name: "asset_generate",
        summary: "",
        status: "done",
        arguments: {
          ...spec,
          name: options.text,
          reference: { kind: "photo", photoId: options.photoId },
        },
      },
      { kind: "text", markdown: options.text },
    ],
    status: "done",
    createdAt: time,
  };
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "planner-designer-replay-"));
  const source = join(root, "source");
  const projectFolder = join(root, "project");
  writePhotos({
    folder: join(source, "photos"),
    photos: [
      { photoId: SAVED_PHOTO, bytes: "lamp" },
      { photoId: OTHER_PHOTO, bytes: "chair" },
    ],
  });
  writeJson({
    path: join(source, "chat.json"),
    value: [
      imageMessage({ id: "m1", photoId: OTHER_PHOTO }),
      designerReply({ id: "m2", photoId: OTHER_PHOTO, text: "Chair queued." }),
      imageMessage({ id: "m3", photoId: SAVED_PHOTO }),
      designerReply({ id: "m4", photoId: SAVED_PHOTO, text: "Lamp queued." }),
    ],
  });
  writePhotos({
    folder: join(projectFolder, "photos"),
    photos: [{ photoId: REPLAY_PHOTO, bytes: "lamp" }],
  });
  return { root, source, projectFolder };
}

function prompt(photoId: string) {
  return [
    "add this",
    "Attached photo files (inspect each image; use Read when images are not attached directly):",
    JSON.stringify([`/project/photos/vision/${photoId}.jpg`]),
  ].join("\n");
}

it("replays the saved asset_generate and reply for the same photo file under its new id", () => {
  const paths = setup();
  try {
    expect(
      replayDesignerTurn({
        source: paths.source,
        projectFolder: paths.projectFolder,
        prompt: prompt(REPLAY_PHOTO),
        heldItems: [],
      }),
    ).toEqual([
      {
        kind: "tool",
        name: "asset_generate",
        arguments: {
          ...spec,
          name: "Lamp queued.",
          reference: { kind: "photo", photoId: REPLAY_PHOTO },
        },
      },
      { kind: "text", text: "Lamp queued." },
    ]);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

it("fails when the attached photo matches no saved chat photo", () => {
  const paths = setup();
  try {
    const unknown = "00000000-0000-4000-8000-0000000000b2";
    writePhotos({
      folder: join(paths.projectFolder, "photos"),
      photos: [{ photoId: unknown, bytes: "sofa" }],
    });
    expect(() =>
      replayDesignerTurn({
        source: paths.source,
        projectFolder: paths.projectFolder,
        prompt: prompt(unknown),
        heldItems: [],
      }),
    ).toThrow("No saved designer asset_generate for the attached photo");
    expect(() =>
      replayDesignerTurn({
        source: paths.source,
        projectFolder: paths.projectFolder,
        prompt: "add a lamp",
        heldItems: [],
      }),
    ).toThrow("Replay designer turns need an attached photo");
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

it("places a held item where it sits in the source project", () => {
  const paths = setup();
  try {
    const placement = {
      kind: "wall",
      wallId: "00000000-0000-4000-8000-0000000000c1",
      alongM: 1.45,
      heightM: 0.38,
      rotationRad: 0.5,
    } satisfies Placement;
    const held = {
      id: "00000000-0000-4000-8000-0000000000d1",
      name: "Lamp queued.",
      model: { kind: "asset", assetId: "00000000-0000-4000-8000-0000000000e1" },
      placement,
      sizeM: spec.sizeM,
      locked: false,
    } satisfies Item;
    expect(
      replayDesignerTurn({
        source: paths.source,
        projectFolder: paths.projectFolder,
        prompt: prompt(REPLAY_PHOTO),
        heldItems: [
          { ...held, name: "Chair queued.", placement: spec.placement },
          held,
        ],
      }).at(0),
    ).toEqual({
      kind: "tool",
      name: "asset_generate",
      arguments: {
        ...spec,
        name: "Lamp queued.",
        placement,
        reference: { kind: "photo", photoId: REPLAY_PHOTO },
      },
    });
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});
