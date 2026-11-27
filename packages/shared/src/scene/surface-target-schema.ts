import { z } from "zod";
import { IdSchema } from "./id-schema.ts";

export const SurfaceTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("surface"), surfaceId: IdSchema }).strict(),
  z.object({ kind: z.literal("walls") }).strict(),
]);
export type SurfaceTarget = z.infer<typeof SurfaceTargetSchema>;
