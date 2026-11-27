import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { type Entry, open, type ZipFile } from "yauzl";
import { HttpError } from "../http/http-error.ts";

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

function invalid(message: string) {
  return new HttpError({ status: 400, message });
}

function isUnixMode(entry: Entry) {
  return entry.versionMadeBy >> 8 === 3;
}

/** Extract the zip at `archivePath` into the empty folder `target`, skipping `.planner/` and rejecting links, paths outside `target`, and archives over the entry or size caps. */
export async function extractProjectArchive(options: {
  archivePath: string;
  target: string;
  maxEntries?: number;
  maxTotalBytes?: number;
}) {
  const maxEntries = options.maxEntries ?? 20_000;
  const maxTotalBytes = options.maxTotalBytes ?? 4 * 1024 ** 3;
  const zip = await promisify<string, { lazyEntries: true }, ZipFile>(open)(
    options.archivePath,
    { lazyEntries: true },
  ).catch((error: unknown) => {
    throw invalid(
      `Not a project archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const root = resolve(options.target);
  try {
    if (zip.entryCount > maxEntries)
      throw invalid(`The archive has more than ${maxEntries} entries`);
    const openReadStream = promisify(zip.openReadStream.bind(zip));
    let totalBytes = 0;
    await new Promise<void>((resolveAll, reject) => {
      zip.on("error", (error: Error) => reject(invalid(error.message)));
      zip.on("end", resolveAll);
      zip.on("entry", (entry: Entry) => {
        (async () => {
          const name = entry.fileName;
          const mode = isUnixMode(entry)
            ? (entry.externalFileAttributes >>> 16) & S_IFMT
            : 0;
          const isDirectory = name.endsWith("/");
          if (mode !== 0 && mode !== (isDirectory ? S_IFDIR : S_IFREG))
            throw invalid(`${name} is not a regular file or folder`);
          const path = resolve(root, name);
          if (path !== root && !path.startsWith(root + sep))
            throw invalid(`${name} is outside the project folder`);
          if (name === ".planner" || name.startsWith(".planner/")) return;
          if (isDirectory) {
            mkdirSync(path, { recursive: true });
            return;
          }
          totalBytes += entry.uncompressedSize;
          if (totalBytes > maxTotalBytes)
            throw invalid(
              `The archive is larger than ${maxTotalBytes} bytes unpacked`,
            );
          mkdirSync(dirname(path), { recursive: true });
          await pipeline(
            await openReadStream(entry),
            createWriteStream(path, { flags: "wx" }),
          );
        })().then(
          () => zip.readEntry(),
          (error: unknown) =>
            reject(
              error instanceof HttpError
                ? error
                : invalid(
                    error instanceof Error ? error.message : String(error),
                  ),
            ),
        );
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}
