import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join, resolve } from "node:path";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { ChatSendResultSchema } from "@planner/shared/src/protocol/chat-send-result-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import sharp from "sharp";
import { z } from "zod";
import { HOOK_SCRIPT_PATH } from "../agent/hooks.ts";
import { createTestFixture, TEST_WEB_ORIGIN } from "../create-test-fixture.ts";
import { readPhotos } from "./read-photos.ts";

export async function verifyChatPhotos() {
  const fixture = await createTestFixture({
    env: () => ({ PLANNER_FAKE_SCENARIO: "photo-choice" }),
  });
  try {
    const project = fixture.daemon.store.createProject({
      name: "Photo gate",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    });
    const folder = fixture.daemon.store.projectPath(project.id);
    const base = `http://127.0.0.1:${fixture.address.port}/projects/${project.id}`;
    const headers = { origin: TEST_WEB_ORIGIN };
    const source = readFileSync(
      new URL("../../test/fixtures/oriented.heic", import.meta.url),
    );
    const photoIds: string[] = [];
    for (const origin of ["capture", "chat"]) {
      const upload = await fetch(
        `${base}/photos?fileName=rotated.heic&origin=${origin}`,
        { method: "POST", headers, body: source },
      );
      assert.equal(upload.status, 201, await upload.clone().text());
      const photo = PhotoUploadResultSchema.parse(await upload.json());
      photoIds.push(photo.photoId);
      assert.deepEqual(
        readFileSync(join(folder, "photos", photo.fileName)),
        source,
      );
      const response = await fetch(`${base}/photos/${photo.photoId}`, {
        headers,
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/jpeg");
      const bytes = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.width, 80);
      assert.equal(metadata.height, 120);
      assert.equal(metadata.orientation, undefined);
      const { data, info } = await sharp(bytes)
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (const [x, y, channel] of [
        [10, 10, 2],
        [70, 10, 0],
        [70, 110, 1],
      ]) {
        assert.ok(x !== undefined && y !== undefined && channel !== undefined);
        const offset = (y * info.width + x) * info.channels;
        assert.ok(
          (data[offset + channel] ?? 0) > 200,
          "Rotated HEIC corner has the wrong color",
        );
        for (const other of [0, 1, 2].filter((value) => value !== channel))
          assert.ok((data[offset + other] ?? 0) < 90);
      }
      const thumb = await fetch(`${base}/photos/${photo.photoId}?size=thumb`, {
        headers,
      });
      assert.equal(thumb.status, 200);
      assert.ok(
        (await sharp(Buffer.from(await thumb.arrayBuffer())).metadata())
          .width <= 240,
      );
    }
    assert.deepEqual(
      readPhotos(folder).map((photo) => photo.origin),
      ["capture", "chat"],
    );
    const browser = await fixture.connectBrowser();
    async function command(input: { type: string; [name: string]: unknown }) {
      const ack = CommandAckSchema.parse(await browser.command(input));
      assert.ok(ack.ok, ack.ok ? "" : ack.error);
      return ack.result;
    }
    for (const cli of ["claude", "codex", "codex"]) {
      if (cli === "codex")
        await command({
          type: "config.update",
          roles: {
            surveyor: { cli: "claude", model: "claude-sonnet-5-5" },
            modeler: { cli: "claude", model: "claude-opus-5-5" },
            designer: { cli, model: "gpt-5" },
          },
        });
      const sent = ChatSendResultSchema.parse(
        await command({ type: "chat.send", projectId: project.id, photoIds }),
      );
      const finished = await browser.next(
        (frame) =>
          z
            .object({
              event: z.object({
                kind: z.literal("chat.message.finished"),
                messageId: z.literal(sent.agentMessageId),
              }),
            })
            .safeParse(frame).success,
      );
      assert.ok(
        z
          .object({ event: z.object({ status: z.literal("done") }) })
          .safeParse(finished).success,
        JSON.stringify(finished),
      );
      const history = ChatHistoryResultSchema.parse(
        await command({ type: "chat.history", projectId: project.id }),
      );
      const user = history.messages.find(
        (message) => message.id === sent.userMessageId,
      );
      assert.deepEqual(
        user?.blocks.map((block) =>
          block.kind === "image" ? block.photoId : block.kind,
        ),
        photoIds,
      );
      const reply = history.messages.find(
        (message) => message.id === sent.agentMessageId,
      );
      assert.ok(reply?.blocks.some((block) => block.kind === "choice"));
      assert.ok(
        reply?.blocks.some(
          (block) =>
            block.kind === "text" &&
            block.markdown === `Inspected ${photoIds.length} photos.`,
        ),
      );
    }
    for (const invalid of [
      {},
      { photoIds: [] },
      { photoIds: ["missing"] },
      { photoIds: Array(7).fill(photoIds.at(0)) },
    ]) {
      assert.equal(
        CommandAckSchema.parse(
          await browser.command({
            type: "chat.send",
            projectId: project.id,
            ...invalid,
          }),
        ).ok,
        false,
      );
    }
    const url = `${base}/photos/${photoIds.at(0)}`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal(
      (await fetch(url, { headers: { origin: "https://foreign.test" } }))
        .status,
      403,
    );
    assert.equal(
      (
        await fetch(url, {
          headers: {
            authorization: `Bearer ${fixture.daemon.auth.internalToken}`,
          },
        })
      ).status,
      200,
    );
    for (const id of ["missing", "%2e%2e%2fproject.json", "__proto__", ".."]) {
      const status = await new Promise<number | undefined>(
        (resolveStatus, reject) => {
          request(`${base}/photos/${id}`, { headers }, (response) => {
            response.resume();
            resolveStatus(response.statusCode);
          })
            .once("error", reject)
            .end();
        },
      );
      assert.equal(status, 404);
    }
    const linkId = `${"a".repeat(32)}.jpg`;
    mkdirSync(join(folder, ".planner", "links"), { recursive: true });
    const jpeg = readFileSync(
      join(folder, "photos", "vision", `${photoIds.at(0)}.jpg`),
    );
    writeFileSync(join(folder, ".planner", "links", linkId), jpeg);
    const link = await fetch(`${base}/links/${linkId}`, { headers });
    assert.equal(link.status, 200);
    assert.deepEqual(Buffer.from(await link.arrayBuffer()), jpeg);
    const vision = join(folder, "photos", "vision");
    symlinkSync(join(folder, "project.json"), join(vision, "outside.jpg"));
    for (const path of [
      join(folder, "project.json"),
      join(vision, "outside.jpg"),
      join(vision, "..", "photos.json"),
    ]) {
      const result = spawnSync(process.execPath, [HOOK_SCRIPT_PATH], {
        env: {
          ...process.env,
          PLANNER_READ_ONLY: "1",
          PLANNER_TOOL_ALLOWLIST: '["Read"]',
          PLANNER_READ_ROOT: vision,
        },
        input: JSON.stringify({
          tool_name: "Read",
          tool_input: { file_path: path },
          cwd: resolve(folder),
        }),
      });
      assert.equal(result.status, 2);
    }
  } finally {
    await fixture.close();
  }
}
