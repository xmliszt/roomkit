import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { PassThrough } from "node:stream";
import type { Project } from "@planner/shared/src/project/project-schema.ts";
import { ZipFile } from "yazl";

const SKIPPED_TOP_FOLDERS = new Set([".planner", "renders"]);
const COMPRESSED_EXTENSIONS = /\.(json|jsonl|txt|bin|ply|obj|md)$/i;

/** Return a zip stream of `folder` with `project` as its `project.json`, leaving out `.planner/`, `renders/`, symlinks, leftover `.*.tmp` files and the folder's own `project.json`. */
export function buildProjectArchive(options: {
  folder: string;
  project: Project;
}) {
  const zip = new ZipFile();
  const output = new PassThrough();
  zip.on("error", (error: Error) => output.destroy(error));
  zip.addBuffer(
    Buffer.from(`${JSON.stringify(options.project, null, 2)}\n`),
    "project.json",
  );
  function walk(path: string) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const entryPath = join(path, entry.name);
      const name = relative(options.folder, entryPath).split("\\").join("/");
      if (path === options.folder && SKIPPED_TOP_FOLDERS.has(entry.name))
        continue;
      if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) continue;
      if (entry.isDirectory()) {
        zip.addEmptyDirectory(name);
        walk(entryPath);
      } else if (entry.isFile() && name !== "project.json")
        zip.addFile(entryPath, name, {
          compress: COMPRESSED_EXTENSIONS.test(entry.name),
        });
    }
  }
  walk(options.folder);
  zip.end();
  return zip.outputStream.pipe(output);
}
