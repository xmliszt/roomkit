import type { Role } from "@planner/shared/src/config/config-schema.ts";

export const ROLE_TOOLS = {
  surveyor: ["scene_get", "job_status", "chat_post", "inventory_submit"],
  modeler: [
    "job_status",
    "modeler_read",
    "modeler_write",
    "blender_run",
    "modeler_preview",
    "asset_submit",
  ],
  designer: [
    "render_photo",
    "scene_get",
    "scene_apply",
    "asset_generate",
    "asset_variant",
    "asset_regenerate",
    "surface_set",
    "job_status",
    "chat_post",
  ],
} as const satisfies { [role in Role]: readonly string[] };
