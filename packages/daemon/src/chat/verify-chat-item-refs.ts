import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { AgentChatBlockSchema } from "@planner/shared/src/chat/agent-chat-block-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { ChatSendResultSchema } from "@planner/shared/src/protocol/chat-send-result-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { createTestFixture } from "../create-test-fixture.ts";
import { createChatStore } from "./create-chat-store.ts";

export async function verifyChatItemRefs() {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    async function command(input: { type: string; [key: string]: unknown }) {
      const ack = CommandAckSchema.parse(await browser.command(input));
      assert.ok(ack.ok, ack.ok ? "" : ack.error);
      return ack.result;
    }
    const project = fixture.daemon.store.createProject({
      name: "References",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    });
    const other = fixture.daemon.store.createProject({
      name: "Other",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    });
    const items = ["Coffee table", "Sofa", "Other table"].map(
      (name) =>
        ({
          id: randomUUID(),
          name,
          locked: false,
          model: { kind: "asset", assetId: "charging-port" },
          sizeM: { width: 1, height: 0.5, depth: 0.6 },
          placement: {
            kind: "floor",
            xM: 0,
            zM: 0,
            elevationM: 0,
            rotationRad: 0,
          },
        }) satisfies Item,
    );
    for (const [index, item] of items.entries())
      await command({
        type: "scene.apply",
        projectId: index === 2 ? other.id : project.id,
        command: { type: "item.add", item },
      });
    const references = items.slice(0, 2);
    for (const cli of ["claude", "codex", "codex"]) {
      await command({
        type: "config.update",
        roles: {
          designer: { cli, model: "fake" },
          surveyor: { cli: "claude", model: "fake" },
          modeler: { cli: "claude", model: "fake" },
        },
      });
      const sent = ChatSendResultSchema.parse(
        await command({
          type: "chat.send",
          projectId: project.id,
          text: "[fake:echo-prompt] Fix these objects",
          itemIds: [...references.map((item) => item.id), references.at(0)?.id],
        }),
      );
      await browser.next((value) => {
        const parsed = ServerMessageSchema.safeParse(value);
        return (
          parsed.success &&
          parsed.data.type === "event" &&
          parsed.data.event.kind === "chat.message.finished" &&
          parsed.data.event.messageId === sent.agentMessageId
        );
      });
      const history = ChatHistoryResultSchema.parse(
        await command({ type: "chat.history", projectId: project.id }),
      );
      const user = history.messages.find(
        (message) => message.id === sent.userMessageId,
      );
      assert.deepEqual(
        user?.blocks.filter((block) => block.kind === "item"),
        references.map((item) => ({
          kind: "item",
          itemId: item.id,
          name: item.name,
          assetId: "charging-port",
        })),
      );
      const reply = history.messages.find(
        (message) => message.id === sent.agentMessageId,
      );
      assert.equal(reply?.status, "done");
      const text =
        reply?.blocks
          .flatMap((block) => (block.kind === "text" ? [block.markdown] : []))
          .join("\n") ?? "";
      for (const item of references) {
        assert.ok(text.includes(item.id));
        assert.ok(text.includes(item.name));
      }
    }
    const before = fixture.daemon.chat.list(project.id).length;
    for (const itemIds of [
      [items.at(2)?.id],
      ["missing"],
      [],
      Array.from({ length: 11 }, () => references.at(0)?.id),
    ]) {
      const ack = CommandAckSchema.parse(
        await browser.command({
          type: "chat.send",
          projectId: project.id,
          text: "Invalid",
          itemIds,
        }),
      );
      assert.equal(ack.ok, false);
    }
    assert.equal(fixture.daemon.chat.list(project.id).length, before);
    assert.equal(
      AgentChatBlockSchema.safeParse({
        kind: "item",
        itemId: "test",
        name: "test",
      }).success,
      false,
    );
    const reference = references.at(0);
    assert.ok(reference);
    await command({
      type: "scene.apply",
      projectId: project.id,
      command: {
        type: "item.update",
        itemId: reference.id,
        patch: { name: "" },
      },
    });
    const emptyName = ChatSendResultSchema.parse(
      await command({
        type: "chat.send",
        projectId: project.id,
        text: "[fake:echo-prompt] Update this object",
        itemIds: [reference.id],
      }),
    );
    await browser.next((value) => {
      const parsed = ServerMessageSchema.safeParse(value);
      return (
        parsed.success &&
        parsed.data.type === "event" &&
        parsed.data.event.kind === "chat.message.finished" &&
        parsed.data.event.messageId === emptyName.agentMessageId
      );
    });
    const reloaded = createChatStore({
      bus: fixture.daemon.bus,
      projectPath: fixture.daemon.store.projectPath,
    });
    assert.deepEqual(
      reloaded
        .list(project.id)
        .find((message) => message.id === emptyName.userMessageId)
        ?.blocks.at(0),
      {
        kind: "item",
        itemId: reference.id,
        name: "",
        assetId: "charging-port",
      },
    );
    ChatHistoryResultSchema.parse(
      await command({ type: "chat.history", projectId: project.id }),
    );
    const thumbnail = await fetch(
      `http://127.0.0.1:${fixture.address.port}/projects/${project.id}/assets/charging-port/thumb.png`,
      {
        headers: {
          authorization: `Bearer ${fixture.daemon.auth.internalToken}`,
        },
      },
    );
    assert.equal(thumbnail.status, 200);
    assert.deepEqual(
      Buffer.from(await thumbnail.arrayBuffer()),
      readFileSync("packages/daemon/catalog/charging-port/thumb.png"),
    );
  } finally {
    await fixture.close();
  }
}
