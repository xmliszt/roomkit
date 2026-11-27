import { join } from "node:path";
import { expect, test } from "vitest";
import { createTestFixture } from "../create-test-fixture.ts";
import { writeJson } from "../util/write-json.ts";

test("capture read commands return persisted records and sources without changing them", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const project = fixture.daemon.store.createProject({
      name: "Capture",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    });
    const folder = fixture.daemon.store.projectPath(project.id);
    for (const type of ["photos.list", "reconstruction.scale.get"]) {
      expect(
        await browser.command({ type, projectId: crypto.randomUUID() }),
      ).toMatchObject({ ok: false });
      expect(
        await browser.command({
          type,
          projectId: project.id,
          unexpected: true,
        }),
      ).toMatchObject({ ok: false });
    }
    expect(
      await browser.command({ type: "photos.list", projectId: project.id }),
    ).toMatchObject({ ok: true, result: { photos: [] } });
    expect(
      await browser.command({
        type: "reconstruction.scale.get",
        projectId: project.id,
      }),
    ).toMatchObject({ ok: true, result: { sources: [] } });
    const photos = ["capture", "chat"].map((origin) => ({
      photoId: origin,
      origin,
      sourceFileName: `${origin}.jpg`,
      widthPx: 2000,
      heightPx: 3000,
      orientation: 6,
      blurScore: 0,
      kind: "rejected",
      reason: "blur",
    }));
    writeJson({
      path: join(folder, "photos", "photos.json"),
      value: { version: 1, photos },
    });
    expect(
      await browser.command({ type: "photos.list", projectId: project.id }),
    ).toMatchObject({ ok: true, result: { photos } });
    const sources = [{ kind: "measurement", axis: "height", lengthM: 2.8 }];
    expect(
      await browser.command({
        type: "reconstruction.scale.set",
        projectId: project.id,
        sources,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await browser.command({
        type: "reconstruction.scale.get",
        projectId: project.id,
      }),
    ).toMatchObject({ ok: true, result: { sources } });
    expect(fixture.daemon.store.loadProject(project.id).revision).toBe(0);
    await browser.command({
      type: "reconstruction.scale.set",
      projectId: project.id,
      sources: [],
    });
    expect(
      await browser.command({
        type: "reconstruction.scale.get",
        projectId: project.id,
      }),
    ).toMatchObject({ ok: true, result: { sources: [] } });
  } finally {
    await fixture.close();
  }
});
