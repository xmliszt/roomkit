import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { expect, test } from "vitest";
import { z } from "zod";
import { createReconFixture } from "../../../../scripts/b6/create-recon-fixture.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { JobRecordSchema } from "./job-record-schema.ts";

test("a failed later coverage run keeps each reconstruction's own artifact paths", async () => {
  const fixture = await createReconFixture();
  try {
    const daemon = await fixture.start();
    const project = ProjectSchema.parse(
      await daemon.command({
        type: "project.create",
        name: "Artifact generations",
        room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
      }),
    );
    const photo = readFileSync(
      new URL("../../test/fixtures/oriented.heic", import.meta.url),
    );
    for (const name of ["one", "two"]) {
      const response = await fetch(
        `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/photos?fileName=${name}.heic&origin=capture`,
        {
          method: "POST",
          headers: { origin: fixture.origin },
          body: photo,
        },
      );
      expect(response.status).toBe(201);
    }
    async function run() {
      const { jobId } = z.object({ jobId: z.string() }).parse(
        await daemon.command({
          type: "reconstruction.start",
          projectId: project.id,
        }),
      );
      return daemon.waitFor({
        label: "reconstruction outcome",
        read: () =>
          daemon.frames
            .flatMap((frame) =>
              frame.type === "event" &&
              frame.event.kind === "job.updated" &&
              frame.event.job.id === jobId &&
              (frame.event.job.stage === "done" ||
                frame.event.job.stage === "failed")
                ? [frame.event.job]
                : [],
            )
            .at(-1),
      });
    }
    const first = await run();
    expect(first.stage).toBe("done");
    const folder = join(fixture.root, "projects", project.id);
    function records() {
      return readProjectJobRecords(folder)
        .filter((record) => record.job.kind === "reconstruction")
        .map((record) => JobRecordSchema.parse(record));
    }
    const firstArtifacts = records().find(
      (record) => record.job.id === first.id,
    )?.artifacts;
    expect(firstArtifacts).toBeDefined();
    fixture.control({ mode: "fail-coverage" });
    const second = await run();
    expect(second.stage).toBe("failed");
    expect(second.error).toContain("synthetic coverage failure");
    const current = ProjectSchema.parse(
      await daemon.command({ type: "project.open", projectId: project.id }),
    );
    expect(current.reconstruction?.jobId).toBe(first.id);
    const latest = z
      .object({ scenePath: z.string(), camerasPath: z.string() })
      .parse(
        JSON.parse(readFileSync(join(folder, "recon", "room.json"), "utf8")),
      );
    const secondArtifacts = records().find(
      (record) => record.job.id === second.id,
    )?.artifacts;
    expect(secondArtifacts).toEqual({
      scenePath: realpathSync(resolve(folder, "recon", latest.scenePath)),
      camerasPath: realpathSync(resolve(folder, "recon", latest.camerasPath)),
    });
    expect(secondArtifacts).not.toEqual(firstArtifacts);
    expect(
      records().find((record) => record.job.id === first.id)?.artifacts,
    ).toEqual(firstArtifacts);
    expect(readFileSync(firstArtifacts?.scenePath ?? "", "utf8")).toBe(
      "fake point cloud",
    );
  } finally {
    await fixture.close();
  }
});
