import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";

export function writeJson(options: { path: string; value: unknown }) {
  const temporaryPath = `${options.path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(options.value, null, 2)}\n`,
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    renameSync(temporaryPath, options.path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
