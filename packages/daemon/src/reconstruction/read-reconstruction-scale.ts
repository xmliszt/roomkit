import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ReconstructionScaleResultSchema } from "@planner/shared/src/protocol/reconstruction-scale-result-schema.ts";

export function readReconstructionScale(projectPath: string) {
  const path = join(projectPath, "recon", "scale-input.json");
  return existsSync(path)
    ? ReconstructionScaleResultSchema.parse(
        JSON.parse(readFileSync(path, "utf8")),
      )
    : { sources: [] };
}
