import { readdirSync, rmSync, statSync } from "node:fs";
import { jobFilePath } from "../generation/job-file-path.ts";

export function pruneCropCache(options: { folder: string }) {
  const files = readdirSync(options.folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.jpg$/.test(entry.name))
    .map((entry) => {
      const path = jobFilePath({ folder: options.folder, path: entry.name });
      return { path, stat: statSync(path) };
    })
    .toSorted(
      (a, b) => a.stat.atimeMs - b.stat.atimeMs || a.path.localeCompare(b.path),
    );
  return files.reduce(
    (remaining, file) => {
      if (remaining.count <= 2000 && remaining.bytes <= 200 * 1024 ** 2)
        return remaining;
      rmSync(file.path);
      return {
        count: remaining.count - 1,
        bytes: remaining.bytes - file.stat.size,
      };
    },
    {
      count: files.length,
      bytes: files.reduce((bytes, file) => bytes + file.stat.size, 0),
    },
  );
}
