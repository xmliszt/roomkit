import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SurfaceAssetsResultSchema } from "@planner/shared/src/protocol/surface-assets-result-schema.ts";
import { expect, test } from "vitest";
import { createTestFixture } from "../create-test-fixture.ts";
import { writeJson } from "../util/write-json.ts";

test("surface.assets lists unused textured assets with native sizes, provenance and stable order", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const project = fixture.daemon.store.createProject({
      name: "Library",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    });
    const folder = fixture.daemon.store.projectPath(project.id);
    expect(
      await browser.command({
        type: "surface.assets",
        projectId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await browser.command({
        type: "surface.assets",
        projectId: project.id,
        extra: true,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await browser.command({ type: "surface.assets", projectId: project.id }),
    ).toMatchObject({ ok: true, result: { assets: [] } });
    const materials = [
      {
        kind: "texture",
        repeatSizeM: { u: 0.27, v: 0.22 },
        roughness: 0.65,
        textureAssetId: "wallpaper",
      },
      {
        kind: "tiles",
        tileSizeM: { u: 0.8, v: 0.8 },
        roughness: 0.2,
        groutWidthM: 0.004,
        groutColor: "#cccccc",
        baseColor: "#ffffff",
        textureAssetId: "tiles",
      },
      {
        kind: "planks",
        plankSizeM: { u: 0.18, v: 1.2 },
        roughness: 0.4,
        baseColor: "#bb8866",
        textureAssetId: "planks",
      },
      { kind: "paint", color: "#ffffff", finish: "matte" },
    ];
    for (const [index, material] of materials.entries()) {
      const assetId = ["wallpaper", "tiles", "planks", "paint"].at(index);
      if (!assetId) throw new Error("No fixture ID");
      const assetFolder = join(folder, "assets", assetId);
      mkdirSync(assetFolder, { recursive: true });
      writeFileSync(join(assetFolder, "baseColor.png"), "fixture");
      writeJson({
        path: join(assetFolder, "meta.json"),
        value: {
          id: assetId,
          kind: "surface",
          color: "#ffffff",
          material,
          provenance: {
            method: "surfacer",
            prompt: "fixture",
            sourcePhotoIds: [],
          },
        },
      });
    }
    for (const name of ["incomplete", "broken", "catalog", "mismatch"]) {
      const assetFolder = join(folder, "assets", name);
      mkdirSync(assetFolder, { recursive: true });
      if (name !== "incomplete")
        writeFileSync(join(assetFolder, "baseColor.png"), "fixture");
      writeFileSync(
        join(assetFolder, "meta.json"),
        name === "broken"
          ? "{"
          : name === "catalog"
            ? JSON.stringify({ id: name, kind: "catalog" })
            : readFileSync(join(folder, "assets", "wallpaper", "meta.json")),
      );
    }
    symlinkSync(
      join(folder, "assets", "wallpaper"),
      join(folder, "assets", "linked"),
    );
    const records = ["wallpaper", "tiles"].map((assetId, index) => ({
      job: {
        id: crypto.randomUUID(),
        kind: "surface",
        projectId: project.id,
        surfaceId: index === 0 ? "wall-2" : "floor",
        stage: "ready",
        progress: 1,
        createdAt: `2099-01-0${index + 1}T00:00:00Z`,
        updatedAt: `2099-01-0${index + 1}T00:00:00.000Z`,
      },
      assetId,
      room: project.scene.room,
      photoIds: [],
      prompt: "fixture",
      attempt: 1,
    }));
    writeJson({ path: join(folder, ".planner", "jobs.json"), value: records });
    await browser.command({
      type: "scene.apply",
      projectId: project.id,
      command: {
        type: "surface.update",
        surfaceId: "floor",
        color: "#ffffff",
        material: materials.at(2),
      },
    });
    const response = await browser.command({
      type: "surface.assets",
      projectId: project.id,
    });
    expect(response).toMatchObject({ ok: true });
    if (!response || typeof response !== "object" || !("result" in response))
      throw new Error("No result");
    const assets = SurfaceAssetsResultSchema.parse(response.result).assets;
    expect(assets.map((asset) => asset.assetId)).toEqual([
      "tiles",
      "wallpaper",
      "planks",
    ]);
    expect(assets.at(0)).toMatchObject({
      kind: "tiles",
      tileSizeM: { u: 0.8, v: 0.8 },
      roughness: 0.2,
      sourceSurfaceId: "floor",
      createdAt: "2099-01-02T00:00:00.000Z",
    });
    expect(assets.at(1)).toMatchObject({
      repeatSizeM: { u: 0.27, v: 0.22 },
      sourceSurfaceId: "wall-2",
    });
    expect(assets.at(2)?.sourceSurfaceId).toBeUndefined();
    expect(fixture.daemon.store.loadProject(project.id).revision).toBe(1);
    writeJson({
      path: join(folder, ".planner", "jobs.json"),
      value: records.map((record) => ({
        ...record,
        job: { ...record.job, stage: "generating" },
      })),
    });
    expect(
      await browser.command({ type: "surface.assets", projectId: project.id }),
    ).toMatchObject({ ok: true, result: { assets: [{ assetId: "planks" }] } });
    for (const invalid of [
      "{",
      JSON.stringify({ jobs: [] }),
      JSON.stringify([{}]),
    ]) {
      writeFileSync(join(folder, ".planner", "jobs.json"), invalid);
      const result = await browser.command({
        type: "surface.assets",
        projectId: project.id,
      });
      expect(result).toMatchObject({
        ok: true,
        result: { assets: [{ assetId: "planks" }] },
      });
      if (!result || typeof result !== "object" || !("result" in result))
        throw new Error("Missing result");
      expect(
        SurfaceAssetsResultSchema.parse(result.result).assets.at(0)
          ?.sourceSurfaceId,
      ).toBeUndefined();
    }
  } finally {
    await fixture.close();
  }
});
