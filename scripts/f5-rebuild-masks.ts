import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import { z } from "zod";

const args = process.argv.slice(2);
const folder = args.at(0);
if (
  !folder ||
  folder.startsWith("--") ||
  args.slice(1).some((arg) => arg !== "--apply")
)
  throw new Error(
    "Usage: node scripts/f5-rebuild-masks.ts <project-folder> [--apply]",
  );
const projectFolder = await realpath(resolve(folder));
const apply = args.includes("--apply");

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function isPortOpen(port: number) {
  return new Promise<boolean>((resolvePort) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolvePort(false);
    });
    socket.once("error", () => resolvePort(false));
  });
}

const FINISHED_STAGES = ["held", "done", "ready", "failed", "cancelled"];

async function findApplyBlocker() {
  const daemonFile = join(
    process.env.PLANNER_HOME ?? join(homedir(), ".interior-planner"),
    "daemon.json",
  );
  if (existsSync(daemonFile)) {
    const daemon = z
      .object({ pid: z.number(), port: z.number() })
      .parse(JSON.parse(await readFile(daemonFile, "utf8")));
    if (isProcessAlive(daemon.pid) && (await isPortOpen(daemon.port)))
      return `the daemon is running (pid ${daemon.pid}, port ${daemon.port}); quit the app first`;
  }
  const jobsFile = join(projectFolder, ".planner", "jobs.json");
  if (!existsSync(jobsFile)) return undefined;
  const unfinished = z
    .array(z.object({ job: z.object({ id: z.string(), stage: z.string() }) }))
    .parse(JSON.parse(await readFile(jobsFile, "utf8")))
    .filter((record) => !FINISHED_STAGES.includes(record.job.stage));
  return unfinished.length > 0
    ? `${unfinished.length} job(s) in the project are unfinished (${unfinished.map((record) => record.job.id).join(", ")})`
    : undefined;
}

async function assertApplyAllowed() {
  const blocker = apply ? await findApplyBlocker() : undefined;
  if (blocker) throw new Error(`Refusing --apply: ${blocker}`);
}

await assertApplyAllowed();
const outputFolder = await mkdtemp(join(tmpdir(), "planner-f5-masks-"));
const assetsFolder = join(projectFolder, "assets");
const EligibleSchema = z.object({
  kind: z.string(),
  hasColorMask: z.boolean().optional(),
});
const assets = (
  await Promise.all(
    (
      await readdir(assetsFolder, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const assetFolder = join(assetsFolder, entry.name);
        const metadataPath = join(assetFolder, "meta.json");
        const original = await readFile(metadataPath, "utf8");
        const candidate: unknown = JSON.parse(original);
        const eligible = EligibleSchema.parse(candidate);
        return eligible.hasColorMask && eligible.kind !== "catalog"
          ? {
              folder: assetFolder,
              output: join(outputFolder, entry.name),
              metadataPath,
              original,
              id: AssetMetaSchema.parse(candidate).id,
              fields: z.record(z.string(), z.unknown()).parse(candidate),
            }
          : undefined;
      }),
  )
)
  .filter((asset) => asset !== undefined)
  .toSorted((a, b) => a.folder.localeCompare(b.folder));
await Promise.all(assets.map((asset) => mkdir(asset.output)));
const manifest = join(outputFolder, "manifest.json");
await writeFile(
  manifest,
  JSON.stringify(assets.map(({ folder, output }) => ({ folder, output }))),
);
const repo = fileURLToPath(new URL("../", import.meta.url));
process.stdout.write(`Mask previews: ${outputFolder}\n`);
await new Promise<void>((resolveRun, reject) => {
  const child = spawn(
    join(repo, "scripts/machine-lock.sh"),
    [
      "f5-rebuild-masks",
      process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender",
      "--background",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "--python",
      join(repo, "blender/rebuild_masks.py"),
      "--",
      "--manifest",
      manifest,
    ],
    { stdio: "inherit" },
  );
  child.once("error", reject);
  child.once("exit", (code, signal) =>
    code === 0
      ? resolveRun()
      : reject(new Error(`Mask rebuild failed: ${signal ?? code}`)),
  );
});
const ResultSchema = z.union([
  z.object({
    oldCoverage: z.number(),
    newCoverage: z.number(),
    referenceLuma: z.number().positive(),
  }),
  z.object({ error: z.string() }),
]);
const results = await Promise.all(
  assets.map(async (asset) => ({
    asset,
    result: ResultSchema.parse(
      JSON.parse(await readFile(join(asset.output, "result.json"), "utf8")),
    ),
  })),
);
for (const { asset, result } of results)
  process.stdout.write(
    "error" in result
      ? `${asset.id}: failed: ${result.error}\n`
      : `${asset.id}: ${(result.oldCoverage * 100).toFixed(2)}% → ${(result.newCoverage * 100).toFixed(2)}% surface coverage\n`,
  );
const failed = results.filter(({ result }) => "error" in result).length;
if (apply) {
  await assertApplyAllowed();
  for (const { asset, result } of results) {
    if ("error" in result) continue;
    if ((await readFile(asset.metadataPath, "utf8")) !== asset.original)
      throw new Error(`Metadata changed during rebuild: ${asset.id}`);
    const maskPath = join(asset.folder, "colorMask.png");
    await writeFile(
      `${asset.metadataPath}.tmp`,
      `${JSON.stringify({ ...asset.fields, referenceLuma: result.referenceLuma }, null, 2)}\n`,
    );
    await writeFile(
      `${maskPath}.tmp`,
      await readFile(join(asset.output, "colorMask.png")),
    );
    await rename(`${asset.metadataPath}.tmp`, asset.metadataPath);
    await rename(`${maskPath}.tmp`, maskPath);
  }
  await rm(outputFolder, { recursive: true, force: true });
}
process.stdout.write(
  `${apply ? "Applied" : "Dry run:"} ${results.length - failed} masks, ${failed} failed.${apply ? " Reload the editor." : " Project files unchanged; use --apply to write."}\n`,
);
if (failed > 0) process.exitCode = 1;
