import { CommandSchema } from "@planner/shared/src/commands/command-schema.ts";
import { z } from "zod";
import type { Tool } from "../tool-context.ts";
import { requestOrThrow } from "./request-or-throw.ts";

export const sceneApply: Tool = {
  name: "scene_apply",
  description: [
    "Change the scene with one command, the same commands the editor sends. Sizes and positions are meters, angles radians. Returns {revision}.",
    "Commands: {type:'item.update', itemId, patch:{name?, placement?, sizeM?, locked?, colorAdjust?, mirrored?, cutsOpening?: boolean | null, light?: {on, emitter:{x, y, z}, beam?:{direction:{x, y, z}, angleDeg}, shade?:'opaque'|'translucent', lumens, temperatureK} | null}} (placement and sizeM are replaced whole);",
    "{type:'item.duplicate', itemId, newItemId, placement, mirrored?}; {type:'item.remove', itemId};",
    "{type:'room.update', walls?, ceilingHeightM?, placements?}; {type:'surface.update', surfaceId, color:'#rrggbb'|null, material?:null|SurfaceMaterial};",
    "{type:'camera.set', camera:{positionM, targetM}}.",
    "Placements: {kind:'floor', xM, zM, elevationM, rotationRad} | {kind:'wall', wallId, alongM, heightM, rotationRad} | {kind:'ceiling', xM, zM, rotationRad}.",
    "Item colorAdjust: {kind:'colorize', color:'#rrggbb', strength:0..1} | {kind:'shift', hueShiftDeg:-180..180, saturation:-1..1, lightness:-1..1} | null (reset to the original color).",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "object", description: "One scene command" },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async call(input, context) {
    const { command } = z
      .object({ command: CommandSchema })
      .strict()
      .parse(input);
    return requestOrThrow({
      context,
      command: {
        type: "agent.scene.apply",
        projectId: context.projectId,
        turnId: context.turnId,
        command,
      },
    });
  },
};
