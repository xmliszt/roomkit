import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { RegistryModel } from "../preflight/read-model-registry.ts";
import { readModelWeights } from "../preflight/read-model-weights.ts";
import { downloadModelWeights } from "./download-model-weights.ts";

const body = randomBytes(256 * 1024);
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function buildModel(options: { sha256: string }): RegistryModel {
  return {
    id: "fake",
    name: "Fake",
    folder: "fake",
    repo: "org/fake",
    revision: "abc",
    files: [
      { path: "model.safetensors", sizeBytes: body.byteLength, ...options },
    ],
  };
}

async function startServer(
  handler: (options: {
    range: string | undefined;
    respond: (input: {
      start: number;
      dropAtByte?: number;
      ignoresRange?: boolean;
    }) => void;
    reject: (status: number) => void;
  }) => void,
) {
  const ranges: (string | undefined)[] = [];
  const server: Server = createServer((request, response) => {
    ranges.push(request.headers.range);
    handler({
      range: request.headers.range,
      respond(input) {
        const start = input.ignoresRange ? 0 : input.start;
        response.writeHead(start > 0 ? 206 : 200, {
          "content-length": body.byteLength - start,
          ...(start > 0
            ? {
                "content-range": `bytes ${start}-${body.byteLength - 1}/${body.byteLength}`,
              }
            : {}),
        });
        if (input.dropAtByte === undefined) {
          response.end(body.subarray(start));
          return;
        }
        response.write(body.subarray(start, input.dropAtByte), () =>
          setTimeout(() => response.socket?.destroy(), 50),
        );
      },
      reject(status) {
        response.writeHead(status).end();
      },
    });
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(() => server.close());
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("no address");
  return { baseUrl: `http://127.0.0.1:${address.port}`, ranges };
}

function createWeightsRoot() {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp/weights-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const sha256 = createHash("sha256").update(body).digest("hex");

test("resumes a dropped download with a range request and writes the completion marker", async () => {
  const server = await startServer(({ range, respond }) => {
    const start = Number(/^bytes=(\d+)-$/.exec(range ?? "")?.at(1) ?? 0);
    respond(start === 0 ? { start, dropAtByte: 100_000 } : { start });
  });
  const weightsRoot = createWeightsRoot();
  const model = buildModel({ sha256 });
  const lines: string[] = [];
  const progress: number[] = [];
  await downloadModelWeights({
    model,
    baseUrl: server.baseUrl,
    weightsRoot,
    signal: new AbortController().signal,
    onLine: (line) => lines.push(line),
    onProgress: (value) => progress.push(value),
    retryDelayMs: 10,
  });
  expect(server.ranges).toStrictEqual([undefined, "bytes=100000-"]);
  expect(
    readFileSync(join(weightsRoot, "fake", "model.safetensors")).equals(body),
  ).toBe(true);
  expect(progress.at(-1)).toBe(1);
  expect(progress.some((value) => value > 0 && value < 1)).toBe(true);
  expect(lines).toContain("Resuming model.safetensors at 100 kB of 262 kB");
  expect(readModelWeights({ model, weightsRoot })).toMatchObject({
    state: "present",
  });
});

test("a .part file left by an earlier run reads as partial and the next run resumes it", async () => {
  const server = await startServer(({ range, respond }) =>
    respond({ start: Number(/^bytes=(\d+)-$/.exec(range ?? "")?.at(1) ?? 0) }),
  );
  const weightsRoot = createWeightsRoot();
  const model = buildModel({ sha256 });
  mkdirSync(join(weightsRoot, "fake"), { recursive: true });
  writeFileSync(
    join(weightsRoot, "fake", ".download.json"),
    JSON.stringify({ revision: "abc" }),
  );
  writeFileSync(
    join(weightsRoot, "fake", "model.safetensors.part"),
    body.subarray(0, 5000),
  );
  expect(readModelWeights({ model, weightsRoot })).toMatchObject({
    state: "partial",
    sizeBytes: 5000,
  });
  await downloadModelWeights({
    model,
    baseUrl: server.baseUrl,
    weightsRoot,
    signal: new AbortController().signal,
    onLine: () => undefined,
    onProgress: () => undefined,
  });
  expect(server.ranges).toStrictEqual(["bytes=5000-"]);
  expect(readModelWeights({ model, weightsRoot }).state).toBe("present");
});

test("a checksum mismatch deletes the download and fails", async () => {
  const server = await startServer(({ respond }) => respond({ start: 0 }));
  const weightsRoot = createWeightsRoot();
  await expect(
    downloadModelWeights({
      model: buildModel({ sha256: "0".repeat(64) }),
      baseUrl: server.baseUrl,
      weightsRoot,
      signal: new AbortController().signal,
      onLine: () => undefined,
      onProgress: () => undefined,
    }),
  ).rejects.toThrowError("does not match its checksum");
  expect(existsSync(join(weightsRoot, "fake", "model.safetensors.part"))).toBe(
    false,
  );
  expect(existsSync(join(weightsRoot, "fake", "model.safetensors"))).toBe(
    false,
  );
});

test("an HTTP 404 fails at once without retrying", async () => {
  const server = await startServer(({ reject }) => reject(404));
  await expect(
    downloadModelWeights({
      model: buildModel({ sha256 }),
      baseUrl: server.baseUrl,
      weightsRoot: createWeightsRoot(),
      signal: new AbortController().signal,
      onLine: () => undefined,
      onProgress: () => undefined,
      retryDelayMs: 10,
    }),
  ).rejects.toThrowError("HTTP 404");
  expect(server.ranges).toHaveLength(1);
});

test("a folder from another revision is cleared, and a kept file with the wrong checksum is downloaded again", async () => {
  const server = await startServer(({ respond }) => respond({ start: 0 }));
  const weightsRoot = createWeightsRoot();
  const model = buildModel({ sha256 });
  const folder = join(weightsRoot, "fake");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, ".download.json"),
    JSON.stringify({ revision: "old" }),
  );
  writeFileSync(join(folder, "stale.json"), "{}");
  writeFileSync(
    join(folder, "model.safetensors"),
    randomBytes(body.byteLength),
  );
  await downloadModelWeights({
    model,
    baseUrl: server.baseUrl,
    weightsRoot,
    signal: new AbortController().signal,
    onLine: () => undefined,
    onProgress: () => undefined,
  });
  expect(existsSync(join(folder, "stale.json"))).toBe(false);
  expect(readFileSync(join(folder, "model.safetensors")).equals(body)).toBe(
    true,
  );
  writeFileSync(
    join(folder, "model.safetensors"),
    randomBytes(body.byteLength),
  );
  await downloadModelWeights({
    model,
    baseUrl: server.baseUrl,
    weightsRoot,
    signal: new AbortController().signal,
    onLine: () => undefined,
    onProgress: () => undefined,
  });
  expect(server.ranges).toHaveLength(2);
  expect(readFileSync(join(folder, "model.safetensors")).equals(body)).toBe(
    true,
  );
  expect(readModelWeights({ model, weightsRoot })).toMatchObject({
    state: "present",
    sizeBytes: body.byteLength,
  });
});

test("a server that ignores the range restarts the file, and failing at the same offset ends the job", async () => {
  const server = await startServer(({ range, respond }) =>
    respond({
      start: Number(/^bytes=(\d+)-$/.exec(range ?? "")?.at(1) ?? 0),
      ignoresRange: true,
      dropAtByte: 100_000,
    }),
  );
  const lines: string[] = [];
  await expect(
    downloadModelWeights({
      model: buildModel({ sha256 }),
      baseUrl: server.baseUrl,
      weightsRoot: createWeightsRoot(),
      signal: new AbortController().signal,
      onLine: (line) => lines.push(line),
      onProgress: () => undefined,
      retryDelayMs: 1,
      maxFailuresInARow: 3,
    }),
  ).rejects.toThrowError("model.safetensors:");
  expect(server.ranges).toStrictEqual([
    undefined,
    "bytes=100000-",
    "bytes=100000-",
  ]);
  expect(lines).toContain(
    "The server ignored the resume range; model.safetensors starts over",
  );
});
