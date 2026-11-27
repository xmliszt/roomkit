import { z } from "zod";
import { ProjectIdSchema } from "../project/project-id-schema.ts";
import { OffsetDateTimeSchema } from "../protocol/date-time-schema.ts";
import { IdSchema } from "../scene/id-schema.ts";
import { InstallTargetSchema } from "./install-target-schema.ts";

const commonFields = {
  id: IdSchema,
  progress: z.number().min(0).max(1),
  lastLogLine: z.string().optional(),
  waitingFor: z.literal("machine").optional(),
  error: z.string().optional(),
  createdAt: OffsetDateTimeSchema,
  updatedAt: OffsetDateTimeSchema,
};

export const GenerationJobSchema = z
  .object({
    ...commonFields,
    kind: z.literal("generation"),
    superseded: z.boolean().optional(),
    projectId: ProjectIdSchema,
    itemId: IdSchema,
    stage: z.enum(["held", "queued", "generating", "ready", "failed"]),
  })
  .strict();

export const AlternativeJobSchema = GenerationJobSchema.extend({
  kind: z.literal("generation-alternative"),
  stage: z.enum(["queued", "generating", "ready", "failed", "cancelled"]),
  method: z.enum(["trellis2", "sam3d"]),
  hasRejectedModel: z.boolean().optional(),
});
export type AlternativeJob = z.infer<typeof AlternativeJobSchema>;

export const InstallJobSchema = z
  .object({
    ...commonFields,
    kind: z.literal("install"),
    target: InstallTargetSchema,
    stage: z.enum(["queued", "running", "done", "failed"]),
  })
  .strict();

export const ReconstructionJobSchema = z
  .object({
    ...commonFields,
    kind: z.literal("reconstruction"),
    pointCloudReady: z.literal(true).optional(),
    projectId: ProjectIdSchema,
    stage: z.enum([
      "queued",
      "intake",
      "geometry",
      "layout",
      "coverage",
      "done",
      "failed",
      "cancelled",
    ]),
  })
  .strict();
export type ReconstructionJob = z.infer<typeof ReconstructionJobSchema>;

export const InventoryJobSchema = z
  .object({
    ...commonFields,
    kind: z.literal("inventory"),
    projectId: ProjectIdSchema,
    reconstructionJobId: IdSchema,
    stage: z.enum([
      "queued",
      "surveying",
      "segmenting",
      "measuring",
      "applying",
      "done",
      "failed",
      "cancelled",
    ]),
  })
  .strict();
export type InventoryJob = z.infer<typeof InventoryJobSchema>;

export const SurfaceJobSchema = z
  .object({
    ...commonFields,
    kind: z.literal("surface"),
    projectId: ProjectIdSchema,
    surfaceId: IdSchema,
    stage: z.enum(["queued", "generating", "ready", "failed", "cancelled"]),
  })
  .strict();
export type SurfaceJob = z.infer<typeof SurfaceJobSchema>;

export const BulbJobSchema = z
  .object({
    ...commonFields,
    kind: z.literal("bulb"),
    projectId: ProjectIdSchema,
    itemId: IdSchema,
    stage: z.enum([
      "queued",
      "rendering",
      "asking",
      "done",
      "failed",
      "cancelled",
    ]),
  })
  .strict();
export type BulbJob = z.infer<typeof BulbJobSchema>;

export const RenderJobSchema = z
  .object({
    ...commonFields,
    kind: z.literal("render"),
    projectId: ProjectIdSchema,
    stage: z.enum([
      "queued",
      "exporting",
      "rendering",
      "done",
      "failed",
      "cancelled",
    ]),
    startedAt: OffsetDateTimeSchema.optional(),
    finishedAt: OffsetDateTimeSchema.optional(),
  })
  .strict();
export type RenderJob = z.infer<typeof RenderJobSchema>;

export const JobSchema = z.discriminatedUnion("kind", [
  RenderJobSchema,
  GenerationJobSchema,
  AlternativeJobSchema,
  InstallJobSchema,
  ReconstructionJobSchema,
  InventoryJobSchema,
  SurfaceJobSchema,
  BulbJobSchema,
]);

export type Job = z.infer<typeof JobSchema>;
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
export type InstallJob = z.infer<typeof InstallJobSchema>;
