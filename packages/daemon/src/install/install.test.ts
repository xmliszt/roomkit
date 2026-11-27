import { once } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { PreflightSchema } from "@planner/shared/src/preflight/preflight-schema.ts";
import { InstallBatchResultSchema } from "@planner/shared/src/protocol/install-batch-result-schema.ts";
import { InstallLogResultSchema } from "@planner/shared/src/protocol/install-log-result-schema.ts";
import { InstallStartResultSchema } from "@planner/shared/src/protocol/install-start-result-schema.ts";
import { expect, test } from "vitest";
import { z } from "zod";
import { createTestFixture } from "../create-test-fixture.ts";
import { buildMissingRequirementNotice } from "../preflight/build-missing-requirement-notice.ts";
import { readLockHash } from "../preflight/read-lock-hash.ts";

const OkSchema = z.object({ ok: z.literal(true), result: z.unknown() });
const RefusedSchema = z.object({ ok: z.literal(false), error: z.string() });

function jobUpdate(options: { jobId: string; stage: string }) {
  return (value: unknown) =>
    z
      .object({
        type: z.literal("event"),
        event: z.object({
          kind: z.literal("job.updated"),
          job: z.object({
            id: z.literal(options.jobId),
            stage: z.literal(options.stage),
          }),
        }),
      })
      .safeParse(value).success;
}

test("preflight reports missing tools, the registry models, and names a missing requirement", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const preflight = PreflightSchema.parse(
      OkSchema.parse(await browser.command({ type: "preflight.check" })).result,
    );
    expect(preflight.blender).toMatchObject({
      state: "missing",
      path: fixture.env.BLENDER,
    });
    expect(preflight.uv.state).toBe("missing");
    expect(preflight.pythonEnv).toMatchObject({
      state: "missing",
      path: `${fixture.env.PLANNER_HOME}/python/.venv`,
    });
    expect(
      preflight.models.map((model) => [model.id, model.state]),
    ).toStrictEqual([
      ["map-anything", "missing"],
      ["sam2.1-hiera-large", "missing"],
      ["sam3-mlx", "missing"],
      ["trellis2", "missing"],
      ["trellis2-sparse-decoder", "missing"],
      ["dinov3-vitl16", "missing"],
      ["rmbg2", "missing"],
      ["sam-3d-objects-mlx", "missing"],
    ]);
    expect(preflight.agents.map((agent) => agent.cli)).toStrictEqual([
      "claude",
      "codex",
    ]);
    expect(
      buildMissingRequirementNotice({
        preflight,
        requirements: [{ kind: "python-env" }, { kind: "blender" }],
      }),
    ).toStrictEqual({
      kind: "notice",
      text: "This step needs the Python env. Create it in Settings.",
      detail: { kind: "missing-requirement", settingsSection: "python" },
    });
    expect(
      buildMissingRequirementNotice({ preflight, requirements: [] }),
    ).toBeUndefined();
  } finally {
    await fixture.close();
  }
});

test("installs run one at a time, a repeated start returns the same job, and weights cannot be deleted while downloading", async () => {
  const stalled = createServer(() => undefined).listen(0, "127.0.0.1");
  await once(stalled, "listening");
  const address = stalled.address();
  if (address === null || typeof address === "string")
    throw new Error("no address");
  const fixture = await createTestFixture({
    env: () => ({
      PLANNER_WEIGHTS_BASE_URL: `http://127.0.0.1:${address.port}`,
    }),
  });
  try {
    const browser = await fixture.connectBrowser();
    async function start(target: unknown) {
      return InstallStartResultSchema.parse(
        OkSchema.parse(await browser.command({ type: "install.start", target }))
          .result,
      ).jobId;
    }
    const download = await start({
      kind: "weights-download",
      modelId: "map-anything",
    });
    await browser.next(jobUpdate({ jobId: download, stage: "running" }));
    expect(
      await start({ kind: "weights-download", modelId: "map-anything" }),
    ).toBe(download);
    expect(
      RefusedSchema.parse(
        await browser.command({
          type: "install.start",
          target: { kind: "weights-delete", modelId: "map-anything" },
        }),
      ).error,
    ).toBe("These weights are downloading; wait for the download to end");
    expect(
      RefusedSchema.parse(
        await browser.command({
          type: "install.start",
          target: { kind: "weights-download", modelId: "no-such-model" },
        }),
      ).error,
    ).toBe("Unknown model: no-such-model");
    const uv = await start({ kind: "uv" });
    await browser.next(jobUpdate({ jobId: uv, stage: "queued" }));
    const snapshot = z
      .object({
        jobs: z.array(z.object({ id: z.string(), stage: z.string() })),
      })
      .parse(await (await fixture.connectBrowser()).frame("snapshot"));
    expect(snapshot.jobs).toStrictEqual([
      expect.objectContaining({ id: download, stage: "running" }),
      expect.objectContaining({ id: uv, stage: "queued" }),
    ]);
  } finally {
    await fixture.close();
    stalled.closeAllConnections();
    stalled.close();
  }
});

test("creating the Python env without uv fails and names uv", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const jobId = InstallStartResultSchema.parse(
      OkSchema.parse(
        await browser.command({
          type: "install.start",
          target: { kind: "python-env" },
        }),
      ).result,
    ).jobId;
    expect(
      await browser.next(jobUpdate({ jobId, stage: "failed" })),
    ).toMatchObject({
      event: { job: { error: "uv is not installed. Install uv first." } },
    });
  } finally {
    await fixture.close();
  }
});

test("the Python env reads present only after a sync of the current uv.lock finished", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    async function pythonEnv() {
      return PreflightSchema.parse(
        OkSchema.parse(await browser.command({ type: "preflight.check" }))
          .result,
      ).pythonEnv;
    }
    const venv = join(fixture.env.PLANNER_HOME, "python", ".venv");
    mkdirSync(join(venv, "bin"), { recursive: true });
    writeFileSync(
      join(venv, "bin", "python"),
      '#!/bin/sh\necho "Python 3.13.18"\n',
      { mode: 0o755 },
    );
    expect(await pythonEnv()).toMatchObject({
      state: "error",
      message: "The Python env is incomplete. Create it again.",
    });
    writeFileSync(
      join(venv, ".interior-planner.json"),
      JSON.stringify({ lockSha256: "0".repeat(64) }),
    );
    expect(await pythonEnv()).toMatchObject({
      state: "error",
      message: "The Python env is older than uv.lock. Create it again.",
    });
    writeFileSync(
      join(venv, ".interior-planner.json"),
      JSON.stringify({ lockSha256: readLockHash(resolve("python")) }),
    );
    expect(await pythonEnv()).toMatchObject({
      state: "present",
      version: "3.13.18",
    });
  } finally {
    await fixture.close();
  }
});

test("install.log keeps the last 2000 lines and counts from the job's first line", async () => {
  const fixture = await createTestFixture({
    env: (root) => {
      mkdirSync(root, { recursive: true });
      writeFileSync(
        join(root, "chatty-brew"),
        '#!/bin/sh\ni=0\nwhile [ $i -lt 2100 ]; do echo "line $i"; i=$((i+1)); done\n',
        { mode: 0o755 },
      );
      return { PLANNER_BREW_BIN: join(root, "chatty-brew") };
    },
  });
  try {
    const browser = await fixture.connectBrowser();
    const jobId = InstallStartResultSchema.parse(
      OkSchema.parse(
        await browser.command({
          type: "install.start",
          target: { kind: "uv" },
        }),
      ).result,
    ).jobId;
    await browser.next(jobUpdate({ jobId, stage: "done" }));
    const log = InstallLogResultSchema.parse(
      OkSchema.parse(await browser.command({ type: "install.log", jobId }))
        .result,
    );
    expect(log.firstLineIndex).toBe(101);
    expect(log.lines).toHaveLength(2000);
    expect(log.lines.at(0)).toBe("line 100");
    expect(log.lines.at(-1)).toBe("line 2099");
  } finally {
    await fixture.close();
  }
});

test("a guided batch puts uv ahead of an existing queued Python install", async () => {
  const fixture = await createTestFixture({
    env(root) {
      const brew = join(root, "held-brew");
      writeFileSync(
        brew,
        `#!/bin/sh
if [ "$*" = "install --cask blender" ]; then
  while [ ! -f "$FAKE_TOOLS_BIN/release" ]; do sleep 0.05; done
fi
exec '${resolve("test/fake-tools/brew")}' "$@"
`,
        { mode: 0o755 },
      );
      return { PLANNER_BREW_BIN: brew };
    },
  });
  try {
    const browser = await fixture.connectBrowser();
    async function start(target: unknown) {
      const ack = await browser.command({ type: "install.start", target });
      return InstallStartResultSchema.parse(OkSchema.parse(ack).result).jobId;
    }
    await browser.next(
      jobUpdate({ jobId: await start({ kind: "blender" }), stage: "running" }),
    );
    const pythonId = await start({ kind: "python-env" });
    const ack = await browser.command({
      type: "install.batch.start",
      targets: [{ kind: "uv" }, { kind: "python-env" }],
    });
    const batch = InstallBatchResultSchema.parse(OkSchema.parse(ack).result);
    expect(batch.jobIds).toContain(pythonId);
    mkdirSync(fixture.env.FAKE_TOOLS_BIN, { recursive: true });
    writeFileSync(join(fixture.env.FAKE_TOOLS_BIN, "release"), "");
    await browser.next(jobUpdate({ jobId: pythonId, stage: "done" }));
  } finally {
    await fixture.close();
  }
});

test("agent installs refresh preflight for Claude Code and Codex", async () => {
  const fixture = await createTestFixture({
    env: (root) => ({
      PLANNER_CLAUDE_BIN: join(root, "tools", "claude"),
      PLANNER_CODEX_BIN: join(root, "tools", "codex"),
    }),
  });
  try {
    const browser = await fixture.connectBrowser();
    async function readAgents() {
      const ack = await browser.command({ type: "preflight.check" });
      return PreflightSchema.parse(OkSchema.parse(ack).result).agents.map(
        (agent) => [agent.cli, agent.status],
      );
    }
    expect(await readAgents()).toEqual([
      ["claude", "not-installed"],
      ["codex", "not-installed"],
    ]);
    const ack = await browser.command({
      type: "install.batch.start",
      targets: [
        { kind: "agent", cli: "claude" },
        { kind: "agent", cli: "codex" },
      ],
    });
    const batch = InstallBatchResultSchema.parse(OkSchema.parse(ack).result);
    expect(new Set(batch.jobIds).size).toBe(2);
    for (const jobId of batch.jobIds)
      await browser.next(jobUpdate({ jobId, stage: "done" }));
    expect(await readAgents()).toEqual([
      ["claude", "ready"],
      ["codex", "ready"],
    ]);
  } finally {
    await fixture.close();
  }
});

test("batch failure skips dependents, continues independent jobs and permits retry", async () => {
  const fixture = await createTestFixture({
    env(root) {
      const brew = join(root, "failing-brew");
      mkdirSync(join(root, "tools"), { recursive: true });
      writeFileSync(join(root, "tools", "fail-uv"), "");
      writeFileSync(
        brew,
        `#!/bin/sh
if [ "$*" = "install uv" ] && [ -f "$FAKE_TOOLS_BIN/fail-uv" ]; then exit 1
fi
exec '${resolve("test/fake-tools/brew")}' "$@"
`,
        { mode: 0o755 },
      );
      return { PLANNER_BREW_BIN: brew };
    },
  });
  try {
    const browser = await fixture.connectBrowser();
    async function startBatch(kinds: string[]) {
      const ack = await browser.command({
        type: "install.batch.start",
        targets: kinds.map((kind) => ({ kind })),
      });
      return InstallBatchResultSchema.parse(OkSchema.parse(ack).result).jobIds;
    }
    const [uv, python, blender] = await startBatch([
      "uv",
      "python-env",
      "blender",
    ]);
    if (!uv || !python || !blender) throw new Error("Setup jobs are missing");
    await browser.next(jobUpdate({ jobId: uv, stage: "failed" }));
    expect(
      await browser.next(jobUpdate({ jobId: python, stage: "failed" })),
    ).toMatchObject({
      event: {
        job: { error: expect.stringContaining("earlier setup step failed") },
      },
    });
    await browser.next(jobUpdate({ jobId: blender, stage: "done" }));
    rmSync(join(fixture.env.FAKE_TOOLS_BIN, "fail-uv"));
    const retry = await startBatch(["uv", "python-env"]);
    expect(retry).not.toContain(uv);
    expect(retry).not.toContain(python);
    for (const jobId of retry)
      await browser.next(jobUpdate({ jobId, stage: "done" }));
  } finally {
    await fixture.close();
  }
});
