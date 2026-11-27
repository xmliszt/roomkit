import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { buildTestZip } from "./build-test-zip.ts";
import { extractProjectArchive } from "./extract-project-archive.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function writeArchive(entries: Parameters<typeof buildTestZip>[0]) {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp/archive-"));
  roots.push(root);
  const archivePath = join(root, "a.iplan");
  writeFileSync(archivePath, buildTestZip(entries));
  return { archivePath, target: join(root, "out") };
}

test("skips .planner entries and writes the rest", async () => {
  const paths = writeArchive([
    { name: "project.json", data: Buffer.from("{}") },
    { name: ".planner/jobs.json", data: Buffer.from("[]") },
    { name: "photos/a.jpg", data: Buffer.from("x") },
  ]);
  await extractProjectArchive(paths);
  expect(existsSync(join(paths.target, "photos", "a.jpg"))).toBe(true);
  expect(existsSync(join(paths.target, ".planner"))).toBe(false);
});

test("refuses an archive with more entries than the cap", async () => {
  const paths = writeArchive(
    [1, 2, 3].map((n) => ({ name: `${n}.txt`, data: Buffer.from("x") })),
  );
  await expect(
    extractProjectArchive({ ...paths, maxEntries: 2 }),
  ).rejects.toThrow("more than 2 entries");
});

test("refuses an archive larger than the cap unpacked", async () => {
  const paths = writeArchive([
    { name: "a.txt", data: Buffer.alloc(6) },
    { name: "b.txt", data: Buffer.alloc(6) },
  ]);
  await expect(
    extractProjectArchive({ ...paths, maxTotalBytes: 10 }),
  ).rejects.toThrow("larger than 10 bytes unpacked");
});
