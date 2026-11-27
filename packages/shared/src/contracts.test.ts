import { describe, expect, test } from "vitest";
import type { z } from "zod";
import { ChatBlockSchema } from "./chat/chat-block-schema.ts";
import { ChatMessageSchema } from "./chat/chat-message-schema.ts";
import { ConfigSchema } from "./config/config-schema.ts";
import { createDefaultConfig } from "./config/create-default-config.ts";
import { JobSchema } from "./jobs/job-schema.ts";
import { PreflightSchema } from "./preflight/preflight-schema.ts";
import { ProjectIdSchema } from "./project/project-id-schema.ts";
import { ProjectSchema } from "./project/project-schema.ts";
import { AuthMessageSchema } from "./protocol/auth-message-schema.ts";
import { ClientCommandSchema } from "./protocol/client-command-schema.ts";
import { PhotoUploadResultSchema } from "./protocol/photo-upload-result-schema.ts";
import { PlannerEventSchema } from "./protocol/planner-event-schema.ts";
import { ProjectRemoveResultSchema } from "./protocol/project-remove-result-schema.ts";
import { SceneApplyResultSchema } from "./protocol/scene-apply-result-schema.ts";
import { ServerMessageSchema } from "./protocol/server-message-schema.ts";
import { SnapshotSaveResultSchema } from "./protocol/snapshot-save-result-schema.ts";
import { AssetMetaSchema } from "./scene/asset-meta-schema.ts";
import { createRectangularScene } from "./scene/create-rectangular-scene.ts";
import { SceneSchema } from "./scene/scene-schema.ts";

const at = "2026-11-22T10:00:00.000Z";
const projectId = "00000000-0000-4000-8000-000000000001";
const scene = createRectangularScene({
  widthM: 4,
  depthM: 5,
  ceilingHeightM: 2.6,
});
const job = {
  id: "job-1",
  kind: "generation",
  projectId,
  itemId: "sofa",
  stage: "generating",
  progress: 0.4,
  lastLogLine: "step 3 of 8",
  createdAt: at,
  updatedAt: at,
};
const installJob = {
  id: "00000000-0000-4000-8000-000000000002",
  kind: "install",
  target: { kind: "weights-download", modelId: "map-anything" },
  stage: "running",
  progress: 0.25,
  lastLogLine: "model.safetensors: 1.23 GB of 4.91 GB",
  createdAt: at,
  updatedAt: at,
};
const preflight = {
  checkedAt: at,
  agents: [],
  blender: {
    state: "present",
    path: "/opt/homebrew/bin/blender",
    version: "5.3.0",
    message: "Blender 5.3.0",
  },
  uv: {
    state: "missing",
    path: "/opt/homebrew/bin/uv",
    message: "uv is not installed.",
  },
  pythonEnv: {
    state: "error",
    path: "/tmp/home/python/.venv",
    version: "3.12.1",
    message:
      "The Python env has Python 3.12.1; it needs 3.13. Create it again.",
  },
  models: [
    {
      id: "map-anything",
      name: "MapAnything",
      path: "/tmp/home/python/weights/map-anything",
      sizeBytes: 1000,
      expectedSizeBytes: 4914068256,
      state: "partial",
    },
  ],
};
const media = { src: "photos/p1.jpg", fileName: "p1.jpg", sizeBytes: 1200 };

const chatBlocks: z.input<typeof ChatBlockSchema>[] = [
  {
    kind: "render",
    jobId: "render-1",
    fileName: "render-1.png",
    sizeBytes: 1000,
    widthPx: 1920,
    heightPx: 1080,
  },
  { kind: "text", markdown: "**done**" },
  {
    kind: "item",
    itemId: "table",
    name: "Coffee table",
    assetId: "table-model",
  },
  {
    kind: "image",
    photoId: "photo-1",
    fileName: media.fileName,
    sizeBytes: media.sizeBytes,
  },
  { kind: "video", ...media, format: "mp4" },
  { kind: "link", url: "https://example.test/sofa", domain: "example.test" },
  { kind: "file", ...media, fileType: "PDF" },
  {
    kind: "asset",
    assetId: "asset-1",
    name: "Sofa",
    sizeM: { width: 2.1, height: 0.8, depth: 0.9 },
  },
  { kind: "job", jobId: "job-1" },
  {
    kind: "tool",
    toolCallId: "call-1",
    name: "scene_apply",
    summary: "item.update ×3",
    status: "done",
    durationMs: 400,
  },
  {
    kind: "diff",
    changes: [{ label: "width", before: "2.10 m", after: "2.25 m" }],
    undo: [{ type: "item.remove", itemId: "sofa" }],
  },
  {
    kind: "capture-request",
    wallId: "wall-2",
    standM: { x: 0, z: 0 },
    lookAtM: { x: -2, z: 0 },
    text: "the wall to the right of the window",
  },
  {
    kind: "choice",
    choiceId: "choice-1",
    question: "Add it or use it as a reference?",
    options: [
      { id: "add", label: "Add it" },
      { id: "reference", label: "Use as reference" },
    ],
  },
  { kind: "notice", text: "The job failed", detail: { kind: "error" } },
  {
    kind: "notice",
    text: "Usage limit reached",
    detail: { kind: "usage-limit", resetAt: at },
  },
  {
    kind: "notice",
    text: "Blender is not installed",
    detail: { kind: "missing-requirement", settingsSection: "blender" },
  },
];

const valid: { [name: string]: { schema: z.ZodTypeAny; value: unknown } } = {
  "a scene": { schema: SceneSchema, value: scene },
  "a project": {
    schema: ProjectSchema,
    value: { id: projectId, name: "Living room", revision: 0, scene },
  },
  "asset meta": {
    schema: AssetMetaSchema,
    value: {
      id: "asset-1",
      kind: "variant",
      nativeSizeM: { width: 2.1, height: 0.8, depth: 0.9 },
      mount: "floor",
      triangleCount: 42000,
      hasColorMask: true,
      parentAssetId: "asset-0",
      referenceLuma: 0.62,
      provenance: { method: "recolor", sourcePhotoIds: ["p1"] },
    },
  },
  "a job": { schema: JobSchema, value: job },
  "an install job": { schema: JobSchema, value: installJob },
  "a preflight": { schema: PreflightSchema, value: preflight },
  "preflight.check": {
    schema: ClientCommandSchema,
    value: { type: "preflight.check", force: true },
  },
  "install.start": {
    schema: ClientCommandSchema,
    value: { type: "install.start", target: { kind: "blender" } },
  },
  "install.log": {
    schema: ClientCommandSchema,
    value: { type: "install.log", jobId: installJob.id },
  },
  "blender.path.set with a path": {
    schema: ClientCommandSchema,
    value: { type: "blender.path.set", path: "/Applications/Blender.app" },
  },
  "blender.path.set that clears the path": {
    schema: ClientCommandSchema,
    value: { type: "blender.path.set" },
  },
  "a job.log event": {
    schema: PlannerEventSchema,
    value: {
      kind: "job.log",
      jobId: installJob.id,
      firstLineIndex: 12,
      lines: ["==> Fetching blender"],
    },
  },
  "a preflight.updated event": {
    schema: PlannerEventSchema,
    value: { kind: "preflight.updated", preflight },
  },
  "the default config": { schema: ConfigSchema, value: createDefaultConfig() },
  "a chat message": {
    schema: ChatMessageSchema,
    value: {
      id: "m1",
      author: { kind: "agent", role: "designer" },
      blocks: chatBlocks,
      status: "streaming",
      createdAt: at,
    },
  },
  "project.rename": {
    schema: ClientCommandSchema,
    value: { type: "project.rename", projectId, name: "Den" },
  },
  "project.remove": {
    schema: ClientCommandSchema,
    value: { type: "project.remove", projectId },
  },
  "a project.renamed event": {
    schema: PlannerEventSchema,
    value: { kind: "project.renamed", project: { id: projectId, name: "Den" } },
  },
  "a project.removed event": {
    schema: PlannerEventSchema,
    value: { kind: "project.removed", projectId },
  },
  "a chat.message.added event": {
    schema: PlannerEventSchema,
    value: {
      kind: "chat.message.added",
      projectId,
      message: {
        id: "m2",
        author: { kind: "user" },
        blocks: [{ kind: "text", markdown: "move the port" }],
        status: "done",
        createdAt: at,
      },
    },
  },
  "a chat.text.appended event": {
    schema: PlannerEventSchema,
    value: {
      kind: "chat.text.appended",
      projectId,
      messageId: "m1",
      blockIndex: 0,
      text: "Moving",
    },
  },
  "a chat.block.set event": {
    schema: PlannerEventSchema,
    value: {
      kind: "chat.block.set",
      projectId,
      messageId: "m1",
      blockIndex: 1,
      block: { kind: "job", jobId: "job-1" },
    },
  },
  "a chat.message.finished event": {
    schema: PlannerEventSchema,
    value: {
      kind: "chat.message.finished",
      projectId,
      messageId: "m1",
      status: "stopped",
    },
  },
  "a photo upload result": {
    schema: PhotoUploadResultSchema,
    value: {
      photoId: "6f1c8bb0-0000-4000-8000-000000000000",
      fileName: "6f1c8bb0-0000-4000-8000-000000000000.heic",
    },
  },
  "a snapshot save result": {
    schema: SnapshotSaveResultSchema,
    value: { fileName: "2026-11-22T10-15-30-123Z-1.png" },
  },
  "a project.remove result": {
    schema: ProjectRemoveResultSchema,
    value: { projectId },
  },
  "project.create": {
    schema: ClientCommandSchema,
    value: {
      type: "project.create",
      requestId: "11111111-1111-4111-8111-111111111111",
      name: "Living room",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    },
  },
  "project.open": {
    schema: ClientCommandSchema,
    value: { type: "project.open", projectId },
  },
  "scene.apply": {
    schema: ClientCommandSchema,
    value: {
      type: "scene.apply",
      projectId,
      command: { type: "item.remove", itemId: "sofa" },
    },
  },
  "a scene.changed event": {
    schema: PlannerEventSchema,
    value: {
      kind: "scene.changed",
      projectId,
      command: { type: "item.remove", itemId: "sofa" },
      revision: 1,
    },
  },
  "a snapshot": {
    schema: ServerMessageSchema,
    value: {
      type: "snapshot",
      config: createDefaultConfig(),
      at,
      projects: [{ id: projectId, name: "Living room" }],
      jobs: [job],
    },
  },
  "a job.updated event message": {
    schema: ServerMessageSchema,
    value: { type: "event", event: { kind: "job.updated", job } },
  },
  "a failed ack": {
    schema: ServerMessageSchema,
    value: {
      type: "command.ack",
      requestId: "11111111-1111-4111-8111-111111111111",
      ok: false,
      error: "Invalid command",
    },
  },
  "auth.ok": { schema: ServerMessageSchema, value: { type: "auth.ok" } },
  "auth.error": {
    schema: ServerMessageSchema,
    value: { type: "auth.error", message: "Invalid internal token" },
  },
  auth: { schema: AuthMessageSchema, value: { type: "auth", token: "t" } },
  "a project.created event": {
    schema: PlannerEventSchema,
    value: {
      kind: "project.created",
      project: { id: projectId, name: "Living room" },
    },
  },
  "a passed ack": {
    schema: ServerMessageSchema,
    value: {
      type: "command.ack",
      requestId: "r1",
      ok: true,
      result: { revision: 1 },
    },
  },
  "a scene.apply result": {
    schema: SceneApplyResultSchema,
    value: { revision: 1 },
  },
};

describe("accepts", () => {
  test.each(Object.entries(valid))("%s", (_name, entry) => {
    expect(entry.schema.parse(entry.value)).toStrictEqual(entry.value);
  });

  test("each of the 14 chat block kinds", () => {
    expect(new Set(chatBlocks.map((block) => block.kind)).size).toBe(14);
    expect(ChatBlockSchema.options).toHaveLength(14);
  });

  test("preserves stored timestamps that omit seconds or the offset colon", () => {
    const checkedAt = "2026-11-22T10:00+0800";
    expect(PreflightSchema.parse({ ...preflight, checkedAt }).checkedAt).toBe(
      checkedAt,
    );
  });

  test("preserves project IDs with existing UUID version and variant bits", () => {
    const legacyId = "00000000-0000-0000-0000-000000000001";
    expect(ProjectIdSchema.parse(legacyId)).toBe(legacyId);
  });
});

const invalid: { [name: string]: { schema: z.ZodTypeAny; value: unknown } } = {
  "a render file name belonging to another job": {
    schema: ChatBlockSchema,
    value: {
      kind: "render",
      jobId: "render-1",
      fileName: "render-2.png",
      sizeBytes: 100,
      widthPx: 1920,
      heightPx: 1080,
    },
  },
  "a scene with an unknown key": {
    schema: SceneSchema,
    value: { ...scene, extra: 1 },
  },
  "a scene of another version": {
    schema: SceneSchema,
    value: { ...scene, version: 2 },
  },
  "a scene whose walls run clockwise": {
    schema: SceneSchema,
    value: {
      ...scene,
      room: { ...scene.room, walls: scene.room.walls.toReversed() },
    },
  },
  "a scene with a surface that is not in the room": {
    schema: SceneSchema,
    value: {
      ...scene,
      room: { ...scene.room, surfaces: { "wall-9": { color: "#ffffff" } } },
    },
  },
  "a project whose id is not a UUID": {
    schema: ProjectSchema,
    value: { id: "../x", name: "Living room", revision: 0, scene },
  },
  "a job with progress above 1": {
    schema: JobSchema,
    value: { ...job, progress: 1.2 },
  },
  "an install job with a generation stage": {
    schema: JobSchema,
    value: { ...installJob, stage: "generating" },
  },
  "an install job for a model id with a path": {
    schema: JobSchema,
    value: {
      ...installJob,
      target: { kind: "weights-delete", modelId: "../python" },
    },
  },
  "a job.log event with no lines": {
    schema: PlannerEventSchema,
    value: { kind: "job.log", jobId: "job-1", firstLineIndex: 0, lines: [] },
  },
  "a job with an unknown stage": {
    schema: JobSchema,
    value: { ...job, stage: "paused" },
  },
  "a config with an unknown CLI": {
    schema: ConfigSchema,
    value: {
      ...createDefaultConfig(),
      roles: {
        ...createDefaultConfig().roles,
        designer: { cli: "gemini", model: "x" },
      },
    },
  },
  "a chat block of an unknown kind": {
    schema: ChatBlockSchema,
    value: { kind: "audio", src: "a.mp3" },
  },
  "a choice with one option": {
    schema: ChatBlockSchema,
    value: {
      kind: "choice",
      choiceId: "c",
      question: "?",
      options: [{ id: "a", label: "A" }],
    },
  },
  "a text block with an unknown key": {
    schema: ChatBlockSchema,
    value: { kind: "text", markdown: "", html: "" },
  },
  "project.create with a room of no width": {
    schema: ClientCommandSchema,
    value: {
      type: "project.create",
      name: "Living room",
      room: { widthM: 0, depthM: 5, ceilingHeightM: 2.6 },
    },
  },
  "scene.apply with an invalid command": {
    schema: ClientCommandSchema,
    value: { type: "scene.apply", projectId, command: { type: "item.move" } },
  },
  "an event of an unknown kind": {
    schema: PlannerEventSchema,
    value: { kind: "project.deleted", projectId },
  },
  "project.rename with a blank name": {
    schema: ClientCommandSchema,
    value: { type: "project.rename", projectId, name: "  " },
  },
  "a chat message without a status": {
    schema: ChatMessageSchema,
    value: { id: "m1", author: { kind: "user" }, blocks: [], createdAt: at },
  },
  "chat.message.finished with a status that is not final": {
    schema: PlannerEventSchema,
    value: {
      kind: "chat.message.finished",
      projectId,
      messageId: "m1",
      status: "streaming",
    },
  },
  "chat.text.appended with no text": {
    schema: PlannerEventSchema,
    value: {
      kind: "chat.text.appended",
      projectId,
      messageId: "m1",
      blockIndex: 0,
      text: "",
    },
  },
  "a snapshot file name that is a path": {
    schema: SnapshotSaveResultSchema,
    value: { fileName: "../project.png" },
  },
  "a command whose requestId is not a UUID": {
    schema: ClientCommandSchema,
    value: { type: "project.open", requestId: "1", projectId },
  },
  "a scene.changed event whose requestId is not a UUID": {
    schema: PlannerEventSchema,
    value: {
      kind: "scene.changed",
      projectId,
      command: { type: "item.remove", itemId: "sofa" },
      revision: 1,
      requestId: "1",
    },
  },
  "a job without a kind": {
    schema: JobSchema,
    value: { ...job, kind: undefined },
  },
  "a job whose project id is not a UUID": {
    schema: JobSchema,
    value: { ...job, projectId: "p1" },
  },
  "asset meta with a referenceLuma of 0": {
    schema: AssetMetaSchema,
    value: {
      id: "asset-1",
      kind: "generated",
      nativeSizeM: { width: 1, height: 1, depth: 1 },
      mount: "floor",
      triangleCount: 1,
      hasColorMask: false,
      referenceLuma: 0,
      provenance: { method: "trellis", sourcePhotoIds: [] },
    },
  },
  "asset meta with a referenceLuma above 1": {
    schema: AssetMetaSchema,
    value: {
      id: "asset-1",
      kind: "generated",
      nativeSizeM: { width: 1, height: 1, depth: 1 },
      mount: "floor",
      triangleCount: 1,
      hasColorMask: false,
      referenceLuma: 1.4,
      provenance: { method: "trellis", sourcePhotoIds: [] },
    },
  },
  "asset meta with a photo id that is a path": {
    schema: AssetMetaSchema,
    value: {
      id: "asset-1",
      kind: "generated",
      nativeSizeM: { width: 1, height: 1, depth: 1 },
      mount: "floor",
      triangleCount: 1,
      hasColorMask: false,
      provenance: { method: "trellis", sourcePhotoIds: ["../p1"] },
    },
  },
  "an asset block whose asset id is a path": {
    schema: ChatBlockSchema,
    value: {
      kind: "asset",
      assetId: "../a",
      name: "Sofa",
      sizeM: { width: 1, height: 1, depth: 1 },
    },
  },
  "a job block whose job id is a path": {
    schema: ChatBlockSchema,
    value: { kind: "job", jobId: "a/b" },
  },
  "a capture request whose wall id is a path": {
    schema: ChatBlockSchema,
    value: {
      kind: "capture-request",
      wallId: "a/b",
      standM: { x: 0, z: 0 },
      lookAtM: { x: 1, z: 0 },
      text: "",
    },
  },
  "auth with an unknown key": {
    schema: AuthMessageSchema,
    value: { type: "auth", token: "t", extra: 1 },
  },
  "a scene.apply result of revision 0": {
    schema: SceneApplyResultSchema,
    value: { revision: 0 },
  },
  "an ack without a requestId": {
    schema: ServerMessageSchema,
    value: { type: "command.ack", ok: true },
  },
};

describe("rejects", () => {
  test.each(Object.entries(invalid))("%s", (_name, entry) => {
    expect(entry.schema.safeParse(entry.value).success).toBe(false);
  });
});
