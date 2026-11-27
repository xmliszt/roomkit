import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export function jobFilePath(options: {
  folder: string;
  path: string;
  writable?: boolean;
}) {
  const root = realpathSync(options.folder);
  const target = resolve(root, options.path);
  if (
    lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink() &&
    !existsSync(target)
  )
    throw new Error("File must stay inside the job folder");
  const existing = existsSync(target)
    ? realpathSync(target)
    : realpathSync(dirname(target));
  for (const path of [target, existing]) {
    const inside = relative(root, path);
    if (inside.startsWith("..") || isAbsolute(inside))
      throw new Error("File must stay inside the job folder");
  }
  if (target === root) throw new Error("Expected a file inside the job folder");
  if (options.writable && !/\.(py|md|txt)$/.test(target))
    throw new Error("Modeler may write only Python scripts and notes");
  return target;
}
