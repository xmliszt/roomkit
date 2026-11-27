import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { ChatSendResultSchema } from "@planner/shared/src/protocol/chat-send-result-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import { WebSocket } from "ws";
import { z } from "zod";
import { createDaemon } from "../packages/daemon/src/create-daemon.ts";

export async function verifyRealPhoto(cli: "claude" | "codex") {
  const root = mkdtempSync(join(tmpdir(), `planner-b5-real-${cli}-`));
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const webPort = address.port;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  const home = join(root, "home");
  mkdirSync(home);
  const config = createDefaultConfig();
  config.roles.designer = {
    cli,
    model:
      process.env.PLANNER_B5_MODEL ??
      (cli === "claude" ? "claude-sonnet-5-5" : "gpt-6.1-sol"),
  };
  writeFileSync(join(home, "config.json"), JSON.stringify(config));
  const daemon = createDaemon({
    env: {
      ...process.env,
      PLANNER_HOME: home,
      PLANNER_PROJECTS: join(root, "projects"),
      PLANNER_PORT: "0",
      PLANNER_WEB_PORT: String(webPort),
      PLANNER_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
    },
  });
  let socket: WebSocket | undefined;
  try {
    const imagePath = join(root, "chair.png");
    await promisify(execFile)(
      process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender",
      [
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python",
        resolve("blender/thumbnail.py"),
        "--",
        "--input",
        resolve("blender/fixtures/chair-wrong-axes.glb"),
        "--output",
        imagePath,
      ],
      { timeout: 120_000, maxBuffer: 10 * 1024 ** 2 },
    );
    const bound = await daemon.listen();
    const project = daemon.store.createProject({
      name: `B5 real ${cli}`,
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    });
    const origin = `http://127.0.0.1:${webPort}`;
    const upload = await fetch(
      `http://127.0.0.1:${bound.port}/projects/${project.id}/photos?origin=chat&fileName=chair.png`,
      { method: "POST", headers: { origin }, body: readFileSync(imagePath) },
    );
    assert.equal(upload.status, 201, await upload.clone().text());
    const photo = PhotoUploadResultSchema.parse(await upload.json());
    const client = new WebSocket(`ws://127.0.0.1:${bound.port}/ws`, {
      headers: { origin },
    });
    socket = client;
    const frames: unknown[] = [];
    client.on("message", (data) => {
      const frame: unknown = JSON.parse(data.toString());
      frames.push(frame);
      process.stdout.write(`${JSON.stringify(frame)}\n`);
    });
    await once(client, "open");
    async function waitFor(predicate: (frame: unknown) => boolean) {
      const deadline = Date.now() + 900_000;
      while (Date.now() < deadline) {
        const frame = frames.find(predicate);
        if (frame !== undefined) return frame;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      throw new Error("Designer timed out");
    }
    async function command(input: { type: string; [key: string]: unknown }) {
      const requestId = crypto.randomUUID();
      client.send(JSON.stringify({ ...input, requestId }));
      const ack = CommandAckSchema.parse(
        await waitFor(
          (frame) =>
            CommandAckSchema.safeParse(frame).data?.requestId === requestId,
        ),
      );
      assert.ok(ack.ok, ack.ok ? "" : ack.error);
      return ack.result;
    }
    const sent = ChatSendResultSchema.parse(
      await command({
        type: "chat.send",
        projectId: project.id,
        photoIds: [photo.photoId],
        text: "Name the type of furniture in the attached image in one sentence. Look at the image, not its file name.",
      }),
    );
    const frame = await waitFor(
      (value) =>
        z
          .object({
            event: z.object({
              kind: z.literal("chat.message.finished"),
              messageId: z.literal(sent.agentMessageId),
            }),
          })
          .safeParse(value).success,
    );
    assert.ok(
      z
        .object({ event: z.object({ status: z.literal("done") }) })
        .safeParse(frame).success,
    );
    const history = ChatHistoryResultSchema.parse(
      await command({ type: "chat.history", projectId: project.id }),
    );
    const reply =
      history.messages
        .find((message) => message.id === sent.agentMessageId)
        ?.blocks.flatMap((block) =>
          block.kind === "text" ? [block.markdown] : [],
        )
        .join("\n") ?? "";
    assert.match(reply, /\bchair\b/i);
    process.stdout.write(`b5 real ${cli} passed: ${reply}\n`);
  } finally {
    socket?.terminate();
    await daemon.close();
    rmSync(root, { recursive: true, force: true });
  }
}
