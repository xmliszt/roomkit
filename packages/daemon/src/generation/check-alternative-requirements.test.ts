import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readModelRegistry } from "../preflight/read-model-registry.ts";
import { checkAlternativeRequirements } from "./check-alternative-requirements.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "planner-alternative-requirements-"));
  roots.push(root);
  const registry = readModelRegistry(undefined);
  registry.models = registry.models.map((model) => ({
    ...model,
    files: [{ path: "fixture.safetensors", sizeBytes: 4 }],
  }));
  for (const model of registry.models) {
    const folder = join(root, model.folder);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "fixture.safetensors"), "data");
  }
  return { python: process.execPath, weightsRoot: root, registry };
}

test("a masked alternative needs no background-removal weights", () => {
  const options = fixture();
  rmSync(join(options.weightsRoot, "rmbg2"), { recursive: true });
  for (const method of ["trellis2", "sam3d"] satisfies (
    | "trellis2"
    | "sam3d"
  )[]) {
    expect(
      checkAlternativeRequirements({ ...options, method, hasMask: true }),
    ).toBeUndefined();
    expect(
      checkAlternativeRequirements({ ...options, method, hasMask: false }),
    ).toMatchObject({
      detail: { kind: "missing-requirement", settingsSection: "python" },
      text: expect.stringContaining("RMBG"),
    });
  }
});

test("an unmasked alternative runs without SAM 3", () => {
  const options = fixture();
  rmSync(join(options.weightsRoot, "sam3-mlx-bf16"), { recursive: true });
  for (const hasMask of [true, false])
    expect(
      checkAlternativeRequirements({ ...options, method: "sam3d", hasMask }),
    ).toBeUndefined();
});

test("TRELLIS needs its sparse decoder and DINO while SAM 3D remains usable", () => {
  const options = fixture();
  for (const id of ["trellis2-sparse-decoder", "dinov3-vitl16"]) {
    const model = options.registry.models.find((model) => model.id === id);
    expect(model).toBeDefined();
    if (!model) throw new Error("Missing registry model");
    const path = join(options.weightsRoot, model.folder, "fixture.safetensors");
    rmSync(path);
    expect(
      checkAlternativeRequirements({
        ...options,
        method: "trellis2",
        hasMask: true,
      }),
    ).toMatchObject({
      detail: { kind: "missing-requirement" },
      text: expect.stringContaining(model.name),
    });
    expect(
      checkAlternativeRequirements({
        ...options,
        method: "sam3d",
        hasMask: true,
      }),
    ).toBeUndefined();
    writeFileSync(path, "data");
  }
});
