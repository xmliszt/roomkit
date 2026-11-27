import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { RegistryModel } from "./read-model-registry.ts";
import { readModelWeights } from "./read-model-weights.ts";

function createFixture() {
  const weightsRoot = mkdtempSync(join(tmpdir(), "planner-weights-"));
  const model = {
    id: "map-anything",
    name: "Fixture model",
    folder: "model",
    repo: "fixture/model",
    revision: "revision-1",
    files: [
      { path: "config.json", sizeBytes: 2 },
      { path: "nested/weights.safetensors", sizeBytes: 4 },
    ],
  } satisfies RegistryModel;
  const folder = join(weightsRoot, model.folder);
  mkdirSync(join(folder, "nested"), { recursive: true });
  return {
    weightsRoot,
    model,
    folder,
    read: () => readModelWeights({ weightsRoot, model }),
    fill() {
      writeFileSync(join(folder, "config.json"), "{}");
      writeFileSync(join(folder, "nested/weights.safetensors"), "data");
    },
    close: () => rmSync(weightsRoot, { recursive: true, force: true }),
  };
}

test("adopts exact-size files without a marker and records the registry revision", () => {
  const fixture = createFixture();
  try {
    fixture.fill();
    expect(fixture.read()).toMatchObject({
      state: "present",
      sizeBytes: 6,
      expectedSizeBytes: 6,
    });
    expect(
      JSON.parse(readFileSync(join(fixture.folder, ".complete.json"), "utf8")),
    ).toEqual({ revision: fixture.model.revision });
    expect(fixture.read().sizeBytes).toBe(6);
  } finally {
    fixture.close();
  }
});

test("requires each exact-size regular file even when a matching marker exists", () => {
  const fixture = createFixture();
  try {
    writeFileSync(
      join(fixture.folder, ".complete.json"),
      JSON.stringify({ revision: fixture.model.revision }),
    );
    expect(fixture.read().state).toBe("missing");
    fixture.fill();
    writeFileSync(join(fixture.folder, "config.json"), "bad");
    expect(fixture.read().state).toBe("partial");
    writeFileSync(join(fixture.folder, "config.json"), "{}");
    rmSync(join(fixture.folder, "nested/weights.safetensors"));
    symlinkSync(
      join(fixture.folder, "config.json"),
      join(fixture.folder, "nested/weights.safetensors"),
    );
    expect(fixture.read().state).toBe("partial");
  } finally {
    fixture.close();
  }
});

test("does not adopt partial files and repairs a stale marker after completion", () => {
  const fixture = createFixture();
  try {
    writeFileSync(join(fixture.folder, "config.json"), "{}");
    writeFileSync(
      join(fixture.folder, "nested/weights.safetensors.part"),
      "data",
    );
    expect(fixture.read().state).toBe("partial");
    expect(existsSync(join(fixture.folder, ".complete.json"))).toBe(false);
    writeFileSync(join(fixture.folder, ".complete.json"), "invalid");
    fixture.fill();
    expect(fixture.read().state).toBe("present");
    expect(
      JSON.parse(readFileSync(join(fixture.folder, ".complete.json"), "utf8")),
    ).toEqual({ revision: fixture.model.revision });
  } finally {
    fixture.close();
  }
});
