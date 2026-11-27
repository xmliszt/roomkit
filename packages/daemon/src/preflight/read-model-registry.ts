import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ModelIdSchema } from "@planner/shared/src/jobs/install-target-schema.ts";
import { z } from "zod";

const RelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      path.split("/").every((part) => part !== "" && part !== ".."),
    "must be a relative path inside the model folder",
  );

const ModelRegistrySchema = z
  .object({
    baseUrl: z.string().url(),
    models: z.array(
      z
        .object({
          id: ModelIdSchema,
          name: z.string().min(1),
          folder: RelativePathSchema,
          repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
          revision: z.string().min(1),
          files: z
            .array(
              z
                .object({
                  path: RelativePathSchema,
                  sizeBytes: z.number().int().nonnegative(),
                  sha256: z
                    .string()
                    .regex(/^[0-9a-f]{64}$/)
                    .optional(),
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;
export type RegistryModel = ModelRegistry["models"][number];

/** Read the model registry at `path`, or the one checked in beside this file when `path` is `undefined`. */
export function readModelRegistry(path: string | undefined) {
  return ModelRegistrySchema.parse(
    JSON.parse(
      readFileSync(
        path ?? fileURLToPath(new URL("model-registry.json", import.meta.url)),
        "utf8",
      ),
    ),
  );
}
