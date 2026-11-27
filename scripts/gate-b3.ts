import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { InstallTarget } from "@planner/shared/src/jobs/install-target-schema.ts";
import { PreflightSchema } from "@planner/shared/src/preflight/preflight-schema.ts";
import { ChatSendResultSchema } from "@planner/shared/src/protocol/chat-send-result-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { InstallLogResultSchema } from "@planner/shared/src/protocol/install-log-result-schema.ts";
import { InstallStartResultSchema } from "@planner/shared/src/protocol/install-start-result-schema.ts";
import {
  type PlannerEvent,
  PlannerEventSchema,
} from "@planner/shared/src/protocol/planner-event-schema.ts";
import { WebSocket } from "ws";
import { z } from "zod";

const root = mkdtempSync(join(tmpdir(), "planner-gate-b3-"));
const plannerHome = join(root, "home");
const projectsRoot = join(root, "projects");
const toolsBin = join(root, "tools");
const children: ChildProcess[] = [];

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

async function listen(server: ReturnType<typeof createHttpServer>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return address.port;
}

const weightsBody = randomBytes(3 * 1024 * 1024);
const configBody = Buffer.from('{"model_type":"fake"}\n');
const model = {
  id: "fake-model",
  name: "Fake model",
  folder: "fake-model",
  repo: "fake-org/fake-model",
  revision: "0123456789abcdef",
  files: [
    { path: "config.json", sizeBytes: configBody.byteLength },
    {
      path: "model.safetensors",
      sizeBytes: weightsBody.byteLength,
      sha256: createHash("sha256").update(weightsBody).digest("hex"),
    },
  ],
};
const registryPath = join(root, "registry.json");
writeFileSync(
  registryPath,
  JSON.stringify({ baseUrl: "https://huggingface.co", models: [model] }),
);

const weightsRequests: { path: string; range: string | undefined }[] = [];
let hasDropped = false;
const weightsServer = createHttpServer((request, response) => {
  const range = request.headers.range;
  weightsRequests.push({ path: request.url ?? "", range });
  const prefix = `/${model.repo}/resolve/${model.revision}/`;
  const name = request.url?.startsWith(prefix)
    ? request.url.slice(prefix.length)
    : undefined;
  const body =
    name === "config.json"
      ? configBody
      : name === "model.safetensors"
        ? weightsBody
        : undefined;
  if (body === undefined) {
    response.writeHead(404).end();
    return;
  }
  const start = Number(/^bytes=(\d+)-$/.exec(range ?? "")?.at(1) ?? 0);
  response.writeHead(range ? 206 : 200, {
    "content-length": body.byteLength - start,
    ...(range
      ? {
          "content-range": `bytes ${start}-${body.byteLength - 1}/${body.byteLength}`,
        }
      : {}),
  });
  if (name === "model.safetensors" && !hasDropped) {
    hasDropped = true;
    const half = Math.floor(body.byteLength / 2);
    response.write(body.subarray(0, half / 2));
    setTimeout(() => {
      response.write(body.subarray(half / 2, half));
      setTimeout(() => response.socket?.destroy(), 300);
    }, 300);
    return;
  }
  response.end(body.subarray(start));
});
const weightsPort = await listen(weightsServer);

const ogImage = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5e1e6f30000000049454e44ae426082",
  "hex",
);
const pageServer = createHttpServer((request, response) => {
  if (request.url === "/sofa") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      '<html><head><title>ignored</title><meta property="og:title" content="Fake Sofa &amp; Co"><meta property="og:image" content="/sofa.png"></head><body></body></html>',
    );
    return;
  }
  if (request.url === "/sofa.png") {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(ogImage);
    return;
  }
  response.writeHead(404).end();
});
const pagePort = await listen(pageServer);

const port = Number(process.env.PLANNER_PORT) || (await freePort());
const webPort = Number(process.env.PLANNER_WEB_PORT) || (await freePort());
const webOrigin = `http://localhost:${webPort}`;

async function startDaemon() {
  for (const folder of ["user-home", "claude-config", "codex-home"])
    mkdirSync(join(root, folder), { recursive: true });
  const child = spawn(process.execPath, ["packages/daemon/src/main.ts"], {
    env: {
      PATH: process.env.PATH,
      HOME: join(root, "user-home"),
      CLAUDE_CONFIG_DIR: join(root, "claude-config"),
      CODEX_HOME: join(root, "codex-home"),
      PLANNER_HOME: plannerHome,
      PLANNER_PROJECTS: projectsRoot,
      PLANNER_PORT: String(port),
      PLANNER_WEB_ORIGIN: webOrigin,
      PLANNER_CLAUDE_BIN: resolve("test/fake-cli/claude"),
      PLANNER_CODEX_BIN: resolve("test/fake-cli/codex"),
      PLANNER_FAKE_SCENARIO: "post-link",
      PLANNER_BREW_BIN: resolve("test/fake-tools/brew"),
      PLANNER_UV_BIN: join(toolsBin, "uv"),
      BLENDER: join(toolsBin, "blender"),
      FAKE_TOOLS_BIN: toolsBin,
      PLANNER_MODEL_REGISTRY: registryPath,
      PLANNER_WEIGHTS_BASE_URL: `http://127.0.0.1:${weightsPort}`,
      PLANNER_LINK_ALLOW_HOSTS: `127.0.0.1:${pagePort}`,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  const daemonFile = join(plannerHome, "daemon.json");
  for (let attempt = 0; attempt < 100 && !existsSync(daemonFile); attempt++) {
    assert.equal(child.exitCode, null, "the daemon exited before it listened");
    await delay(50);
  }
  assert.ok(existsSync(daemonFile), "the daemon did not listen");
}

async function connectBrowser() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { origin: webOrigin },
  });
  const unread: unknown[] = [];
  const events: PlannerEvent[] = [];
  socket.on("message", (data) => {
    const frame: unknown = JSON.parse(data.toString());
    unread.push(frame);
    const event = z
      .object({ type: z.literal("event"), event: PlannerEventSchema })
      .safeParse(frame);
    if (event.success) events.push(event.data.event);
  });
  await once(socket, "open");
  async function send(request: { type: string; [key: string]: unknown }) {
    const requestId = crypto.randomUUID();
    socket.send(JSON.stringify({ ...request, requestId }));
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const index = unread.findIndex(
        (frame) =>
          CommandAckSchema.safeParse(frame).success &&
          z.object({ requestId: z.literal(requestId) }).safeParse(frame)
            .success,
      );
      if (index >= 0) return CommandAckSchema.parse(unread.at(index));
      await delay(10);
    }
    throw new Error(`Timed out waiting for the ack of ${request.type}`);
  }
  async function command(request: { type: string; [key: string]: unknown }) {
    const ack = await send(request);
    assert.ok(ack.ok, `${request.type} failed: ${ack.ok ? "" : ack.error}`);
    return ack.result;
  }
  async function waitForEvent<T extends PlannerEvent>(options: {
    matches: (event: PlannerEvent) => event is T;
    timeoutMs?: number;
  }) {
    const deadline = Date.now() + (options.timeoutMs ?? 30_000);
    while (Date.now() < deadline) {
      const event = events.find(options.matches);
      if (event) return event;
      await delay(10);
    }
    throw new Error("Timed out waiting for an event");
  }
  return { socket, events, send, command, waitForEvent };
}

type Browser = Awaited<ReturnType<typeof connectBrowser>>;

async function runInstall(options: {
  browser: Browser;
  target: InstallTarget;
}) {
  const { browser } = options;
  const preflightCount = browser.events.filter(
    (event) => event.kind === "preflight.updated",
  ).length;
  const { jobId } = InstallStartResultSchema.parse(
    await browser.command({ type: "install.start", target: options.target }),
  );
  const finished = await browser.waitForEvent({
    matches: (event): event is Extract<PlannerEvent, { kind: "job.updated" }> =>
      event.kind === "job.updated" &&
      event.job.id === jobId &&
      (event.job.stage === "done" || event.job.stage === "failed"),
    timeoutMs: 60_000,
  });
  const job = finished.job;
  assert.ok(job.kind === "install");
  assert.equal(
    job.stage,
    "done",
    `install ${options.target.kind} failed: ${job.error}`,
  );
  const deadline = Date.now() + 60_000;
  while (
    browser.events.filter((event) => event.kind === "preflight.updated")
      .length <= preflightCount
  ) {
    assert.ok(Date.now() < deadline, "no preflight after the install job");
    await delay(10);
  }
  const preflight = browser.events
    .flatMap((event) =>
      event.kind === "preflight.updated" ? [event.preflight] : [],
    )
    .at(-1);
  assert.ok(preflight);
  const streamed = browser.events.flatMap((event) =>
    event.kind === "job.log" && event.jobId === jobId ? event.lines : [],
  );
  const updates = browser.events.flatMap((event) =>
    event.kind === "job.updated" && event.job.id === jobId ? [event.job] : [],
  );
  return { jobId, preflight, streamed, updates };
}

try {
  await startDaemon();
  const browser = await connectBrowser();

  const initial = PreflightSchema.parse(
    await browser.command({ type: "preflight.check" }),
  );
  assert.equal(initial.blender.state, "missing", "Blender should be missing");
  assert.equal(initial.uv.state, "missing", "uv should be missing");
  assert.equal(
    initial.pythonEnv.state,
    "missing",
    "the Python env should be missing",
  );
  assert.deepEqual(
    initial.models.map((entry) => [entry.id, entry.state]),
    [["fake-model", "missing"]],
  );
  assert.ok(
    initial.agents.some((agent) => agent.cli === "claude"),
    "preflight includes the coding agents",
  );
  console.log(
    "preflight reports Blender, uv, the Python env and weights missing",
  );

  const uv = await runInstall({ browser, target: { kind: "uv" } });
  assert.ok(
    uv.streamed.some((line) => line.includes("uv was successfully installed")),
    `the uv install log was not streamed: ${uv.streamed.join(" | ")}`,
  );
  assert.ok(
    uv.streamed.every((line) => !line.includes("\x1b")),
    "log lines keep ANSI codes",
  );
  assert.ok(
    uv.streamed.includes("######## 40.0%"),
    "carriage-return progress is split into lines",
  );
  assert.equal(uv.preflight.uv.state, "present");
  assert.equal(uv.preflight.uv.version, "0.13.9");
  console.log(
    `uv installed with fake brew; ${uv.streamed.length} log lines streamed`,
  );

  const blender = await runInstall({ browser, target: { kind: "blender" } });
  assert.ok(
    blender.streamed.some((line) =>
      line.includes("blender was successfully installed"),
    ),
  );
  assert.equal(blender.preflight.blender.state, "present");
  assert.equal(blender.preflight.blender.version, "5.3.0");
  console.log("Blender installed with fake brew; preflight reports 5.3.0");

  const python = await runInstall({ browser, target: { kind: "python-env" } });
  assert.ok(
    python.streamed.some((line) => line.includes("Installed 22 packages")),
  );
  assert.equal(python.preflight.pythonEnv.state, "present");
  assert.equal(python.preflight.pythonEnv.version, "3.13.18");
  assert.ok(
    existsSync(join(plannerHome, "python", ".venv", "bin", "python")),
    "the env is created under PLANNER_HOME/python/.venv",
  );
  const replay = InstallLogResultSchema.parse(
    await browser.command({ type: "install.log", jobId: python.jobId }),
  );
  assert.deepEqual(
    replay.lines,
    python.streamed,
    "install.log replays the log",
  );
  console.log("Python env created with fake uv; install.log replays the log");

  const badPath = await browser.send({
    type: "blender.path.set",
    path: join(root, "no-blender"),
  });
  assert.equal(badPath.ok, false, "a path that does not run is refused");
  const picked = PreflightSchema.parse(
    await browser.command({
      type: "blender.path.set",
      path: join(toolsBin, "blender"),
    }),
  );
  assert.equal(picked.blender.path, join(toolsBin, "blender"));
  assert.equal(
    JSON.parse(readFileSync(join(plannerHome, "config.json"), "utf8"))
      .blenderPath,
    join(toolsBin, "blender"),
  );
  console.log("blender.path.set refuses a bad path and saves a good one");

  const download = await runInstall({
    browser,
    target: { kind: "weights-download", modelId: "fake-model" },
  });
  assert.ok(hasDropped, "the fake server dropped the first connection");
  assert.ok(
    weightsRequests.some(
      (request) =>
        request.path.endsWith("model.safetensors") &&
        request.range !== undefined &&
        request.range !== "bytes=0-",
    ),
    `the download did not resume with a range: ${JSON.stringify(weightsRequests)}`,
  );
  const progress = download.updates
    .map((job) => job.progress)
    .filter((value) => value > 0 && value < 1);
  assert.ok(progress.length >= 2, `too few progress updates: ${progress}`);
  assert.ok(
    download.streamed.some((line) =>
      line.startsWith("Resuming model.safetensors"),
    ),
    "the log says the download resumed",
  );
  const downloaded = download.preflight.models.at(0);
  assert.equal(downloaded?.state, "present");
  assert.equal(
    downloaded?.sizeBytes,
    configBody.byteLength + weightsBody.byteLength,
  );
  assert.ok(
    readFileSync(
      join(plannerHome, "python", "weights", "fake-model", "model.safetensors"),
    ).equals(weightsBody),
    "the downloaded file matches",
  );
  console.log(
    `weights downloaded after a dropped connection; progress ${progress
      .map((value) => value.toFixed(2))
      .join(", ")}`,
  );

  const removed = await runInstall({
    browser,
    target: { kind: "weights-delete", modelId: "fake-model" },
  });
  assert.equal(removed.preflight.models.at(0)?.state, "missing");
  assert.ok(!existsSync(join(plannerHome, "python", "weights", "fake-model")));
  console.log("deleting the weights updates preflight to missing");

  const project = z.object({ id: z.string() }).parse(
    await browser.command({
      type: "project.create",
      name: "Gate B3",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  const { agentMessageId } = ChatSendResultSchema.parse(
    await browser.command({
      type: "chat.send",
      projectId: project.id,
      text: `Look at http://127.0.0.1:${pagePort}/sofa`,
    }),
  );
  const titled = await browser.waitForEvent({
    matches: (
      event,
    ): event is Extract<PlannerEvent, { kind: "chat.block.set" }> =>
      event.kind === "chat.block.set" &&
      event.messageId === agentMessageId &&
      event.block.kind === "link" &&
      event.block.title !== undefined,
  });
  assert.ok(titled.block.kind === "link");
  assert.equal(titled.block.title, "Fake Sofa & Co");
  assert.ok(titled.block.imageSrc, "the OG image was fetched");
  assert.ok(
    readFileSync(join(projectsRoot, project.id, titled.block.imageSrc)).equals(
      ogImage,
    ),
    "the OG image is stored in the project",
  );
  console.log(`link block got its title "${titled.block.title}" and OG image`);

  browser.socket.close();
  console.log("gate:b3 PASS");
} finally {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    children.map((child) =>
      child.exitCode === null ? once(child, "exit") : undefined,
    ),
  );
  weightsServer.close();
  pageServer.close();
  rmSync(root, { recursive: true, force: true });
}
