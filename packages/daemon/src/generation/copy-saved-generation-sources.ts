import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { jobFilePath } from "./job-file-path.ts";

export function copySavedGenerationSources(options: {
  sourcePath: string | undefined;
  projectFolder: string;
  folder: string;
}) {
  if (!options.sourcePath) return undefined;
  const sourceFolder = jobFilePath({
    folder: options.projectFolder,
    path: options.sourcePath,
  });
  const saved = z
    .object({
      photos: z
        .array(z.string().regex(/^photos\/[A-Za-z0-9_-]+\.(jpg|png)$/))
        .min(1),
      masks: z.array(z.string().regex(/^masks\/[A-Za-z0-9_-]+\.png$/)),
    })
    .parse(
      JSON.parse(
        readFileSync(
          jobFilePath({ folder: sourceFolder, path: "job.json" }),
          "utf8",
        ),
      ),
    );
  for (const name of [...saved.photos, ...saved.masks])
    copyFileSync(
      jobFilePath({ folder: sourceFolder, path: name }),
      join(options.folder, name),
    );
  return saved;
}
