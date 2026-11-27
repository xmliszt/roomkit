import { z } from "zod";

export const RoleSchema = z.enum(["surveyor", "modeler", "designer"]);

export const RoleModelSchema = z
  .object({ cli: z.enum(["claude", "codex"]), model: z.string().min(1) })
  .strict();

export const ConfigSchema = z
  .object({
    version: z.literal(1),
    roles: z
      .object({
        surveyor: RoleModelSchema,
        modeler: RoleModelSchema,
        designer: RoleModelSchema,
      })
      .strict(),
    blenderPath: z.string().min(1).optional(),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;
export type Role = z.infer<typeof RoleSchema>;
