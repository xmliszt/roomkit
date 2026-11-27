import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  truncate,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  DOWNLOAD_MARKER,
  readModelDownloadBytes,
} from "../preflight/read-model-download-bytes.ts";
import type { RegistryModel } from "../preflight/read-model-registry.ts";
import { COMPLETE_MARKER } from "../preflight/read-model-weights.ts";
import { writeJson } from "../util/write-json.ts";
import { requireFreeStorage } from "./require-free-storage.ts";

function formatBytes(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.round(bytes / 1e3)} kB`;
}

async function sizeOf(path: string) {
  try {
    return (await stat(path)).size;
  } catch {
    return undefined;
  }
}

async function sha256Of(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

class DownloadRefusedError extends Error {}

/** Download every file of `model` into its folder under `weightsRoot`, resuming `.part` files with HTTP ranges, then write the completion marker. */
export async function downloadModelWeights(options: {
  model: RegistryModel;
  baseUrl: string;
  weightsRoot: string;
  signal: AbortSignal;
  onLine: (line: string) => void;
  onProgress: (fraction: number) => void;
  stallTimeoutMs?: number;
  retryDelayMs?: number;
  maxFailuresInARow?: number;
}) {
  const { model, signal } = options;
  const folder = join(options.weightsRoot, model.folder);
  const startedRevision = await readFile(join(folder, DOWNLOAD_MARKER), "utf8")
    .then(
      (text) =>
        z.object({ revision: z.string() }).parse(JSON.parse(text)).revision,
    )
    .catch(() => undefined);
  requireFreeStorage({
    folder,
    additionalBytes: readModelDownloadBytes({ model, folder }),
  });
  if (startedRevision !== model.revision) {
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
    writeJson({
      path: join(folder, DOWNLOAD_MARKER),
      value: { revision: model.revision },
    });
  }
  await rm(join(folder, COMPLETE_MARKER), { force: true });
  const totalBytes = model.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const doneBytes: { [path: string]: number } = {};
  function reportProgress() {
    const done = Object.values(doneBytes).reduce(
      (sum, value) => sum + value,
      0,
    );
    options.onProgress(totalBytes === 0 ? 1 : Math.min(1, done / totalBytes));
  }
  options.onLine(
    `Downloading ${model.name} (${formatBytes(totalBytes)}) from ${model.repo}`,
  );
  for (const file of model.files) {
    const target = join(folder, file.path);
    const partPath = `${target}.part`;
    await mkdir(dirname(target), { recursive: true });
    if (
      (await sizeOf(target)) === file.sizeBytes &&
      (file.sha256 === undefined || (await sha256Of(target)) === file.sha256)
    ) {
      doneBytes[file.path] = file.sizeBytes;
      reportProgress();
      continue;
    }
    const url = `${options.baseUrl.replace(/\/$/, "")}/${model.repo}/resolve/${model.revision}/${file.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    let failuresInARow = 0;
    let mostSavedBytes = (await sizeOf(partPath)) ?? 0;
    let lastReportedPercent = -1;
    while (true) {
      signal.throwIfAborted();
      const startBytes = Math.min(
        (await sizeOf(partPath)) ?? 0,
        file.sizeBytes,
      );
      if (startBytes === file.sizeBytes) break;
      requireFreeStorage({
        folder: dirname(target),
        additionalBytes: file.sizeBytes - startBytes,
      });
      if (startBytes > 0)
        options.onLine(
          `Resuming ${file.path} at ${formatBytes(startBytes)} of ${formatBytes(file.sizeBytes)}`,
        );
      else
        options.onLine(
          `Downloading ${file.path} (${formatBytes(file.sizeBytes)})`,
        );
      const stall = new AbortController();
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      function armStallTimer() {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(
          () => stall.abort(new Error("no data received")),
          options.stallTimeoutMs ?? 60_000,
        );
      }
      let receivedBytes = 0;
      try {
        armStallTimer();
        const response = await fetch(url, {
          headers: startBytes > 0 ? { range: `bytes=${startBytes}-` } : {},
          signal: AbortSignal.any([signal, stall.signal]),
        });
        if (response.status !== 200 && response.status !== 206)
          await response.body?.cancel();
        if (response.status === 416) {
          await truncate(partPath, 0);
          throw new Error("the server refused the resume range");
        }
        if (response.status >= 400 && response.status < 500)
          throw new DownloadRefusedError(
            `${file.path}: the server answered HTTP ${response.status}`,
          );
        if (response.status !== 200 && response.status !== 206)
          throw new Error(`the server answered HTTP ${response.status}`);
        if (response.body === null) throw new Error("the response has no body");
        const rangeStart = Number(
          /^bytes (\d+)-/
            .exec(response.headers.get("content-range") ?? "")
            ?.at(1),
        );
        if (response.status === 206 && rangeStart !== startBytes) {
          await response.body.cancel();
          await rm(partPath, { force: true });
          throw new Error("the server answered a different range");
        }
        const offset = response.status === 206 ? startBytes : 0;
        if (response.status === 200 && startBytes > 0)
          options.onLine(
            `The server ignored the resume range; ${file.path} starts over`,
          );
        const handle = await open(partPath, offset === 0 ? "w" : "a");
        try {
          for await (const chunk of response.body) {
            armStallTimer();
            if (offset + receivedBytes + chunk.byteLength > file.sizeBytes)
              throw new DownloadRefusedError(
                `${file.path} is larger than the registry says`,
              );
            await handle.write(chunk);
            receivedBytes += chunk.byteLength;
            doneBytes[file.path] = offset + receivedBytes;
            reportProgress();
            const percent = Math.floor(
              ((offset + receivedBytes) / file.sizeBytes) * 20,
            );
            if (percent !== lastReportedPercent) {
              lastReportedPercent = percent;
              options.onLine(
                `${file.path}: ${formatBytes(offset + receivedBytes)} of ${formatBytes(file.sizeBytes)}`,
              );
            }
          }
        } finally {
          await handle.close();
        }
        if (offset + receivedBytes !== file.sizeBytes)
          throw new Error("the connection closed early");
        break;
      } catch (error) {
        if (signal.aborted || error instanceof DownloadRefusedError)
          throw error;
        const savedBytes = (await sizeOf(partPath)) ?? 0;
        failuresInARow = savedBytes > mostSavedBytes ? 1 : failuresInARow + 1;
        mostSavedBytes = Math.max(mostSavedBytes, savedBytes);
        const reason = stall.signal.aborted
          ? "no data received"
          : error instanceof Error
            ? error.message
            : String(error);
        if (failuresInARow >= (options.maxFailuresInARow ?? 5))
          throw new Error(`${file.path}: ${reason}`);
        options.onLine(`${file.path}: ${reason}; retrying`);
        await delay(options.retryDelayMs ?? 1000, undefined, { signal });
      } finally {
        clearTimeout(stallTimer);
      }
    }
    if (file.sha256 !== undefined) {
      options.onLine(`Checking ${file.path}`);
      if ((await sha256Of(partPath)) !== file.sha256) {
        await rm(partPath, { force: true });
        throw new Error(
          `${file.path} does not match its checksum; download it again`,
        );
      }
    }
    await rename(partPath, target);
    doneBytes[file.path] = file.sizeBytes;
    reportProgress();
  }
  writeJson({
    path: join(folder, COMPLETE_MARKER),
    value: { revision: model.revision, completedAt: new Date().toISOString() },
  });
  options.onLine(`${model.name} is ready`);
}
