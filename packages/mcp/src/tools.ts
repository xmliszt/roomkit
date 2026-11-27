import type { Tool } from "./tool-context.ts";
import { assetGenerate } from "./tools/asset-generate.ts";
import { assetRegenerate } from "./tools/asset-regenerate.ts";
import { assetVariant } from "./tools/asset-variant.ts";
import { chatPost } from "./tools/chat-post.ts";
import { createModelerTool } from "./tools/create-modeler-tool.ts";
import { inventorySubmit } from "./tools/inventory-submit.ts";
import { jobStatus } from "./tools/job-status.ts";
import { renderPhoto } from "./tools/render-photo.ts";
import { sceneApply } from "./tools/scene-apply.ts";
import { sceneGet } from "./tools/scene-get.ts";

import { surfaceSet } from "./tools/surface-set.ts";

export const tools: Tool[] = [
  renderPhoto,
  sceneGet,
  sceneApply,
  assetGenerate,
  assetVariant,
  assetRegenerate,
  surfaceSet,
  createModelerTool({
    name: "modeler_read",
    kind: "read",
    description: "Read a file or image inside the job folder.",
    properties: { path: { type: "string" } },
    required: ["path"],
  }),
  createModelerTool({
    name: "modeler_write",
    kind: "write",
    description: "Write a Python script or notes inside the job folder.",
    properties: { path: { type: "string" }, text: { type: "string" } },
    required: ["path", "text"],
  }),
  createModelerTool({
    name: "blender_run",
    kind: "blender",
    description:
      "Run a Python script through the serialized headless Blender wrapper with job.json.",
    properties: { path: { type: "string" } },
    required: ["path"],
  }),
  createModelerTool({
    name: "modeler_preview",
    kind: "preview",
    description:
      "Render raw.glb in three.js; return an image to compare with the photos.",
    properties: {
      azimuthDeg: { type: "number" },
      elevationDeg: { type: "number" },
      environment: { type: "boolean" },
    },
    required: ["azimuthDeg", "elevationDeg"],
  }),
  createModelerTool({
    name: "asset_submit",
    kind: "submit",
    description:
      "Submit this job’s required script, notes and generated outputs for validation.",
    properties: {},
    required: [],
  }),
  jobStatus,
  chatPost,
  inventorySubmit,
];
