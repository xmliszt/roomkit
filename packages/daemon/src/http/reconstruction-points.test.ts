import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createTestFixture, TEST_WEB_ORIGIN } from "../create-test-fixture.ts";
import { writeJson } from "../util/write-json.ts";

test("reconstruction preview is served only from its job's recorded recon path", async () => {
  const fixture = await createTestFixture();
  try {
    const project = fixture.daemon.store.createProject({
      name: "Preview",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    });
    const folder = join(fixture.root, "projects", project.id);
    const run = join(folder, "recon", "run-first");
    mkdirSync(run, { recursive: true });
    const points = Buffer.alloc(8000 * 6 * 4);
    points.writeFloatLE(1.5);
    const pointsPath = join(run, "points.bin");
    writeFileSync(pointsPath, points);
    const job = {
      kind: "reconstruction",
      id: "preview-first",
      projectId: project.id,
      stage: "coverage",
      pointCloudReady: true,
      progress: 0.8,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    function save(path: string) {
      writeJson({
        path: join(folder, ".planner", "jobs.json"),
        value: [
          {
            job,
            photoIds: ["one", "two"],
            sources: [],
            artifacts: {
              scenePath: join(run, "scene.npz"),
              camerasPath: join(run, "cameras.json"),
              pointsPath: path,
            },
          },
        ],
      });
    }
    async function request(jobId = job.id) {
      return fetch(
        `http://127.0.0.1:${fixture.address.port}/projects/${project.id}/reconstruction/${jobId}/points.bin`,
        { headers: { origin: TEST_WEB_ORIGIN } },
      );
    }
    save(pointsPath);
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(points);
    expect((await request("unknown")).status).toBe(404);
    const outside = join(folder, "outside.bin");
    writeFileSync(outside, points);
    save(outside);
    expect((await request()).status).toBe(404);
    const link = join(run, "escape.bin");
    symlinkSync(outside, link);
    save(link);
    expect((await request()).status).toBe(404);
    writeFileSync(pointsPath, Buffer.alloc(4));
    save(pointsPath);
    expect((await request()).status).toBe(404);
  } finally {
    await fixture.close();
  }
});
