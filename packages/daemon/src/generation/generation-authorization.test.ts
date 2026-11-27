import { randomUUID } from "node:crypto";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createTestFixture } from "../create-test-fixture.ts";
import { jobFilePath } from "./job-file-path.ts";

test("generation tools reject browser calls and stale agent turns without changing the scene", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const agent = await fixture.connect();
    agent.socket.send(
      JSON.stringify({
        type: "auth",
        token: fixture.daemon.auth.internalToken,
      }),
    );
    await agent.frame("auth.ok");
    const project = fixture.daemon.store.createProject({
      name: "Authorization",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    });
    const scope = { projectId: project.id, turnId: randomUUID() };
    const commands = [
      {
        type: "agent.asset.regenerate",
        ...scope,
        itemId: "item",
        notes: "oval legs",
      },
      {
        type: "agent.modeler",
        ...scope,
        operation: { kind: "read", path: "job.json" },
      },
      {
        type: "agent.modeler",
        ...scope,
        operation: { kind: "blender", path: "model.py" },
      },
      {
        type: "agent.asset.generate",
        ...scope,
        spec: {
          name: "Sofa",
          prompt: "Sofa",
          reference: { kind: "photo", photoId: "photo" },
          sizeM: { width: 1.8, height: 0.8, depth: 0.9 },
          placement: {
            kind: "floor",
            xM: 0,
            zM: 0,
            elevationM: 0,
            rotationRad: 0,
          },
        },
      },
      {
        type: "agent.asset.variant",
        ...scope,
        spec: {
          itemId: "item",
          name: "Blue",
          change: { kind: "color", color: "#123456", strength: 1 },
        },
      },
    ];
    for (const command of commands) {
      expect(await browser.command(command)).toMatchObject({
        ok: false,
        error: "Only an agent connection may send this command",
      });
      expect(await agent.command(command)).toMatchObject({
        ok: false,
        error: expect.stringContaining("turn is not running"),
      });
    }
    expect(fixture.daemon.store.loadProject(project.id)).toEqual(project);
  } finally {
    await fixture.close();
  }
});

test("job files reject traversal and symlinks outside their folder for both reads and writes", async () => {
  const fixture = await createTestFixture();
  try {
    const folder = join(fixture.root, "job");
    mkdirSync(folder);
    const outside = join(fixture.root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.py"), "secret");
    symlinkSync(outside, join(folder, "linked"));
    symlinkSync(join(outside, "secret.py"), join(folder, "secret.py"));
    symlinkSync(join(outside, "not-created.py"), join(folder, "dangling.py"));
    for (const path of [
      "../outside/secret.py",
      join(outside, "secret.py"),
      "linked/new.py",
      "secret.py",
      "dangling.py",
    ]) {
      expect(() => jobFilePath({ folder, path })).toThrow(
        "inside the job folder",
      );
      expect(() => jobFilePath({ folder, path, writable: true })).toThrow(
        "inside the job folder",
      );
    }
    expect(() =>
      jobFilePath({ folder, path: "job.json", writable: true }),
    ).toThrow("only Python scripts and notes");
    expect(jobFilePath({ folder, path: "model.py", writable: true })).toBe(
      join(folder, "model.py"),
    );
  } finally {
    await fixture.close();
  }
});
