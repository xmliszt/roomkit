import { z } from "zod";
import { AgentChatBlockSchema } from "../chat/agent-chat-block-schema.ts";
import { CommandSchema } from "../commands/command-schema.ts";
import { RoleModelSchema } from "../config/config-schema.ts";
import { GenerationSpecSchema } from "../generation/generation-spec-schema.ts";
import { ModelerOperationSchema } from "../generation/modeler-operation-schema.ts";
import { RegenerationSpecSchema } from "../generation/regeneration-spec-schema.ts";
import { VariantSpecSchema } from "../generation/variant-spec-schema.ts";
import { AppLocaleSchema } from "../i18n/app-locale.ts";
import { InventoryObjectsSchema } from "../inventory/inventory-objects-schema.ts";
import { InstallTargetSchema } from "../jobs/install-target-schema.ts";
import { ProjectIdSchema } from "../project/project-id-schema.ts";
import { ScaleSourcesSchema } from "../reconstruction/scale-source-schema.ts";
import { RenderViewSchema } from "../render/render-view-schema.ts";
import { IdSchema } from "../scene/id-schema.ts";
import { SurfaceTargetSchema } from "../scene/surface-target-schema.ts";
import { TailnetLoginSchema } from "./tailnet-login-schema.ts";

const requestId = z.guid().optional();
const turnId = z.guid();

export const ClientCommandSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("view.report"),
        requestId,
        projectId: ProjectIdSchema,
        view: RenderViewSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("render.start"),
        requestId,
        projectId: ProjectIdSchema,
        view: RenderViewSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("agent.render.start"),
        requestId,
        projectId: ProjectIdSchema,
        turnId,
      })
      .strict(),
    z
      .object({
        type: z.literal("item.sources"),
        requestId,
        projectId: ProjectIdSchema,
        itemId: IdSchema.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("objects.library"),
        requestId,
        projectId: ProjectIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("objects.archived"),
        requestId,
        projectId: ProjectIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("objects.archive"),
        requestId,
        projectId: ProjectIdSchema,
        assetId: IdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("objects.restore"),
        requestId,
        projectId: ProjectIdSchema,
        assetId: IdSchema,
      })
      .strict(),
    RegenerationSpecSchema.extend({
      type: z.literal("generation.regenerate"),
      requestId,
      projectId: ProjectIdSchema,
    }).strict(),
    RegenerationSpecSchema.extend({
      type: z.literal("agent.asset.regenerate"),
      requestId,
      projectId: ProjectIdSchema,
      turnId,
    }).strict(),
    z
      .object({
        type: z.literal("agent.surface.set"),
        requestId,
        projectId: ProjectIdSchema,
        turnId,
        target: SurfaceTargetSchema,
        prompt: z.string().trim().min(1).max(8000),
      })
      .strict(),
    z
      .object({
        type: z.literal("job.cancel"),
        requestId,
        projectId: ProjectIdSchema,
        jobId: IdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("generation.start"),
        requestId,
        projectId: ProjectIdSchema,
        ...RegenerationSpecSchema.pick({ itemId: true, notes: true }).shape,
      })
      .strict(),
    z
      .object({
        type: z.literal("generation.alternatives"),
        requestId,
        projectId: ProjectIdSchema,
        itemId: IdSchema,
        method: z.enum(["trellis2", "sam3d"]).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("agent.asset.generate"),
        requestId,
        projectId: ProjectIdSchema,
        turnId,
        spec: GenerationSpecSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("agent.asset.variant"),
        requestId,
        projectId: ProjectIdSchema,
        turnId,
        spec: VariantSpecSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("agent.modeler"),
        requestId,
        projectId: ProjectIdSchema,
        turnId,
        operation: ModelerOperationSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("inventory.start"),
        requestId,
        projectId: ProjectIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("agent.inventory.submit"),
        requestId,
        projectId: ProjectIdSchema,
        turnId,
        objects: InventoryObjectsSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("bulb.find"),
        requestId,
        projectId: ProjectIdSchema,
        itemId: IdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("surface.assets"),
        requestId,
        projectId: ProjectIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("photos.list"),
        requestId,
        projectId: ProjectIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("reconstruction.scale.get"),
        requestId,
        projectId: ProjectIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("reconstruction.start"),
        requestId,
        projectId: ProjectIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("reconstruction.scale.set"),
        requestId,
        projectId: ProjectIdSchema,
        sources: ScaleSourcesSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("project.create"),
        requestId,
        name: z.string().trim().min(1),
        room: z
          .object({
            widthM: z.number().finite().positive(),
            depthM: z.number().finite().positive(),
            ceilingHeightM: z.number().finite().positive(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        type: z.literal("project.sample.open"),
        requestId,
        resetProjectId: ProjectIdSchema.optional(),
        locale: AppLocaleSchema.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("project.open"),
        requestId,
        projectId: ProjectIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("project.rename"),
        requestId,
        projectId: ProjectIdSchema,
        name: z.string().trim().min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("project.remove"),
        requestId,
        projectId: ProjectIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("scene.apply"),
        requestId,
        projectId: ProjectIdSchema,
        command: CommandSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("chat.send"),
        requestId,
        projectId: ProjectIdSchema,
        text: z.string().trim().min(1).optional(),
        photoIds: z.array(IdSchema).min(1).max(6).optional(),
        itemIds: z.array(IdSchema).min(1).max(10).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("chat.history"),
        requestId,
        projectId: ProjectIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("chat.stop"),
        requestId,
        projectId: ProjectIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("agents.check"),
        requestId,
        force: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("config.update"),
        requestId,
        roles: z
          .object({
            surveyor: RoleModelSchema,
            modeler: RoleModelSchema,
            designer: RoleModelSchema,
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        type: z.literal("agent.login"),
        requestId,
        cli: z.enum(["claude", "codex"]),
      })
      .strict(),
    z
      .object({
        type: z.literal("preflight.check"),
        requestId,
        force: z.boolean().optional(),
      })
      .strict(),
    z.object({ type: z.literal("tailnet.status"), requestId }).strict(),
    z
      .object({
        type: z.literal("tailnet.enable"),
        requestId,
        logins: z.array(TailnetLoginSchema).min(1).max(50),
      })
      .strict(),
    z.object({ type: z.literal("tailnet.disable"), requestId }).strict(),
    z.object({ type: z.literal("language.get"), requestId }).strict(),
    z
      .object({
        type: z.literal("language.set"),
        requestId,
        locale: AppLocaleSchema,
        firstLaunch: z.literal(true).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("install.start"),
        requestId,
        target: InstallTargetSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("install.batch.start"),
        requestId,
        targets: z.array(InstallTargetSchema).min(1).max(20),
      })
      .strict(),
    z
      .object({ type: z.literal("job.log"), requestId, jobId: IdSchema })
      .strict(),
    z
      .object({ type: z.literal("install.log"), requestId, jobId: IdSchema })
      .strict(),
    z
      .object({
        type: z.literal("blender.path.set"),
        requestId,
        path: z.string().trim().min(1).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("agent.scene.apply"),
        requestId,
        projectId: ProjectIdSchema,
        turnId,
        command: CommandSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("agent.chat.post"),
        requestId,
        projectId: ProjectIdSchema,
        turnId,
        blocks: z.array(AgentChatBlockSchema).min(1),
      })
      .strict(),
  ])
  .refine(
    (command) =>
      command.type !== "chat.send" ||
      command.text !== undefined ||
      (command.photoIds?.length ?? 0) > 0,
    "Send text or at least one photo",
  );

export type ClientCommand = z.infer<typeof ClientCommandSchema>;
