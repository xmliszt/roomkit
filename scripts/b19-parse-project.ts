import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { RegenerationSpecSchema } from "@planner/shared/src/generation/regeneration-spec-schema.ts";
import { z } from "zod";
import { GenerationRecordSchema } from "../packages/daemon/src/generation/generation-record-schema.ts";
import { InventoryRecordSchema } from "../packages/daemon/src/inventory/inventory-record-schema.ts";
import { JobRecordSchema } from "../packages/daemon/src/reconstruction/job-record-schema.ts";
import { SurfaceRecordSchema } from "../packages/daemon/src/surfaces/surface-record-schema.ts";

const projectDir = process.argv[2];
if (!projectDir) {
  console.error("Usage: node scripts/b19-parse-project.ts <projectDir>");
  process.exit(2);
}
const root = resolve(projectDir);
const counts: { [label: string]: { parsed: number; failed: number } } = {};
const failures: string[] = [];

function check(input: {
  label: string;
  where: string;
  schema: z.ZodType;
  value: unknown;
}) {
  const result = input.schema.safeParse(input.value);
  counts[input.label] ??= { parsed: 0, failed: 0 };
  const count = counts[input.label];
  if (!count) return;
  if (result.success) {
    count.parsed += 1;
    return;
  }
  count.failed += 1;
  failures.push(
    `${input.label} ${input.where}: ${result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")}`,
  );
}

const jobsPath = join(root, ".planner", "jobs.json");
const records = existsSync(jobsPath)
  ? z
      .array(
        z
          .object({
            job: z.object({ id: z.string(), kind: z.string() }).passthrough(),
          })
          .passthrough(),
      )
      .parse(JSON.parse(readFileSync(jobsPath, "utf8")))
  : [];
const recordSchemas: { [kind: string]: z.ZodType } = {
  generation: GenerationRecordSchema,
  "generation-alternative": GenerationRecordSchema,
  reconstruction: JobRecordSchema,
  inventory: InventoryRecordSchema,
  surface: SurfaceRecordSchema,
};
for (const record of records) {
  const schema = recordSchemas[record.job.kind];
  const where = `${record.job.kind} ${record.job.id}`;
  if (!schema) {
    failures.push(`job record ${where}: unknown kind`);
    continue;
  }
  check({
    label: `job record (${record.job.kind})`,
    where,
    schema,
    value: record,
  });
  const generation = GenerationRecordSchema.safeParse(record);
  if (generation.success && generation.data.regeneration)
    check({
      label: "regeneration record (itemId and notes as a regeneration spec)",
      where,
      schema: RegenerationSpecSchema,
      value: {
        itemId: generation.data.job.itemId,
        ...(generation.data.notes === undefined
          ? {}
          : { notes: generation.data.notes }),
      },
    });
}

const SavedJobSchema = z
  .object({
    reference: GenerationRecordSchema.shape.source,
    photos: z.array(z.string()),
    masks: z.array(z.string()),
  })
  .passthrough();
for (const folder of [
  join(".planner", "generation"),
  "assets",
  join(".planner", "archive"),
]) {
  const path = join(root, folder);
  if (!existsSync(path)) continue;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jobPath = folder.endsWith("generation")
      ? join(path, entry.name, "job.json")
      : join(path, entry.name, "source", "job.json");
    if (!existsSync(jobPath)) continue;
    check({
      label: `saved job.json (${folder})`,
      where: relative(root, jobPath),
      schema: SavedJobSchema,
      value: JSON.parse(readFileSync(jobPath, "utf8")),
    });
  }
}

console.log(`Project: ${root}`);
for (const [label, count] of Object.entries(counts).toSorted(([a], [b]) =>
  a.localeCompare(b),
))
  console.log(`${label}: ${count.parsed} parsed, ${count.failed} failed`);
console.log(`Failures: ${failures.length}`);
for (const failure of failures) console.log(`  ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
