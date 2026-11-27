import { z } from "zod";

const path = z.string().min(1).max(500);
export const ModelerOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("read"), path }).strict(),
  z
    .object({ kind: z.literal("write"), path, text: z.string().max(2_000_000) })
    .strict(),
  z.object({ kind: z.literal("blender"), path }).strict(),
  z
    .object({
      kind: z.literal("preview"),
      azimuthDeg: z.number().finite(),
      elevationDeg: z.number().min(-89).max(89),
      environment: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("submit") }).strict(),
]);
export type ModelerOperation = z.infer<typeof ModelerOperationSchema>;
