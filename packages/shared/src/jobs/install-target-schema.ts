import { z } from "zod";

export const ModelIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9][a-z0-9.-]*$/);

export const InstallTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("uv") }).strict(),
  z
    .object({ kind: z.literal("agent"), cli: z.enum(["claude", "codex"]) })
    .strict(),
  z.object({ kind: z.literal("blender") }).strict(),
  z.object({ kind: z.literal("python-env") }).strict(),
  z
    .object({ kind: z.literal("weights-download"), modelId: ModelIdSchema })
    .strict(),
  z
    .object({ kind: z.literal("weights-delete"), modelId: ModelIdSchema })
    .strict(),
]);

export type InstallTarget = z.infer<typeof InstallTargetSchema>;
