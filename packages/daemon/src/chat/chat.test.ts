import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { ChatSendResultSchema } from "@planner/shared/src/protocol/chat-send-result-schema.ts";
import { expect, test } from "vitest";
import { z } from "zod";
import { createTestFixture } from "../create-test-fixture.ts";

const OkSchema = z.object({ ok: z.literal(true), result: z.unknown() });

async function createProject(
  browser: Awaited<
    ReturnType<Awaited<ReturnType<typeof createTestFixture>>["connectBrowser"]>
  >,
) {
  return ProjectSchema.parse(
    OkSchema.parse(
      await browser.command({
        type: "project.create",
        name: "Chat",
        room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
      }),
    ).result,
  );
}

function finished(messageId: string) {
  return (value: unknown) =>
    z
      .object({
        type: z.literal("event"),
        event: z.object({
          kind: z.literal("chat.message.finished"),
          messageId: z.literal(messageId),
        }),
      })
      .safeParse(value).success;
}

test("a chat message runs a designer turn and streams its reply", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const project = await createProject(browser);
    const { agentMessageId } = ChatSendResultSchema.parse(
      OkSchema.parse(
        await browser.command({
          type: "chat.send",
          projectId: project.id,
          text: "[fake:echo] hi",
        }),
      ).result,
    );
    expect(await browser.next(finished(agentMessageId))).toMatchObject({
      event: { status: "done" },
    });
    const history = ChatHistoryResultSchema.parse(
      OkSchema.parse(
        await browser.command({ type: "chat.history", projectId: project.id }),
      ).result,
    );
    expect(history.messages.map((message) => message.blocks)).toStrictEqual([
      [{ kind: "text", markdown: "[fake:echo] hi" }],
      [{ kind: "text", markdown: "Fake agent reply" }],
    ]);
  } finally {
    await fixture.close();
  }
});

test("refuses a second message while the designer is answering, and stops on request", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const project = await createProject(browser);
    const { agentMessageId } = ChatSendResultSchema.parse(
      OkSchema.parse(
        await browser.command({
          type: "chat.send",
          projectId: project.id,
          text: "[fake:sleep]",
        }),
      ).result,
    );
    expect(
      await browser.command({
        type: "chat.send",
        projectId: project.id,
        text: "again",
      }),
    ).toMatchObject({
      ok: false,
      error: "The designer is still answering in this project",
    });
    expect(
      await browser.command({ type: "chat.stop", projectId: project.id }),
    ).toMatchObject({ ok: true, result: { stopped: true } });
    expect(await browser.next(finished(agentMessageId))).toMatchObject({
      event: { status: "stopped" },
    });
  } finally {
    await fixture.close();
  }
});

test("only a running turn's agent connection may change the scene or post blocks", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const project = await createProject(browser);
    const command = {
      type: "agent.scene.apply",
      projectId: project.id,
      turnId: crypto.randomUUID(),
      command: { type: "surface.update", surfaceId: "floor", color: "#112233" },
    };
    expect(await browser.command(command)).toMatchObject({
      ok: false,
      error: "Only an agent connection may send this command",
    });
    const agent = await fixture.connect();
    agent.socket.send(
      JSON.stringify({
        type: "auth",
        token: fixture.daemon.auth.internalToken,
      }),
    );
    await agent.frame("auth.ok");
    expect(await agent.command(command)).toMatchObject({
      ok: false,
      error: "This agent turn is not running",
    });
    expect(
      await agent.command({
        type: "agent.chat.post",
        projectId: project.id,
        turnId: crypto.randomUUID(),
        blocks: [{ kind: "text", markdown: "plain text" }],
      }),
    ).toMatchObject({ ok: false, error: "Invalid command" });
  } finally {
    await fixture.close();
  }
});

test("config.update changes the designer's CLI and sends a new snapshot", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    await browser.frame("snapshot");
    const roles = {
      surveyor: { cli: "claude", model: "claude-sonnet-5-5" },
      modeler: { cli: "claude", model: "claude-opus-5-5" },
      designer: { cli: "codex", model: "gpt-5" },
    };
    expect(
      await browser.command({ type: "config.update", roles }),
    ).toMatchObject({ ok: true, result: { roles } });
    expect(await browser.frame("snapshot")).toMatchObject({
      config: { roles },
    });
  } finally {
    await fixture.close();
  }
});

async function sendAndFinish(options: {
  browser: Awaited<
    ReturnType<Awaited<ReturnType<typeof createTestFixture>>["connectBrowser"]>
  >;
  projectId: string;
  text: string;
}) {
  const { agentMessageId } = ChatSendResultSchema.parse(
    OkSchema.parse(
      await options.browser.command({
        type: "chat.send",
        projectId: options.projectId,
        text: options.text,
      }),
    ).result,
  );
  const event = await options.browser.next(finished(agentMessageId));
  const history = ChatHistoryResultSchema.parse(
    OkSchema.parse(
      await options.browser.command({
        type: "chat.history",
        projectId: options.projectId,
      }),
    ).result,
  );
  return {
    event,
    message: history.messages.find((message) => message.id === agentMessageId),
  };
}

test("a rich block posted by the agent lands in its reply before the text", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const project = await createProject(browser);
    const { message } = await sendAndFinish({
      browser,
      projectId: project.id,
      text: "[fake:post-choice]",
    });
    expect(message?.status).toBe("done");
    const kinds = message?.blocks.map((block) => block.kind);
    expect(kinds).toHaveLength(3);
    expect(kinds?.slice(0, 2).toSorted()).toStrictEqual(["choice", "tool"]);
    expect(kinds?.at(-1)).toBe("text");
  } finally {
    await fixture.close();
  }
});

test("a usage limit ends the turn with a usage-limit notice", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const project = await createProject(browser);
    const { message } = await sendAndFinish({
      browser,
      projectId: project.id,
      text: "[fake:usage-limit]",
    });
    expect(message?.status).toBe("failed");
    expect(message?.blocks.at(-1)).toMatchObject({
      kind: "notice",
      detail: {
        kind: "usage-limit",
        resetAt: new Date(1900000000 * 1000).toISOString(),
      },
    });
  } finally {
    await fixture.close();
  }
});

test("changing the designer's CLI starts a new session with that CLI", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const project = await createProject(browser);
    await sendAndFinish({
      browser,
      projectId: project.id,
      text: "[fake:echo]",
    });
    const sessionPath = join(
      fixture.env.PLANNER_PROJECTS,
      project.id,
      ".planner",
      "sessions",
      "designer-1.json",
    );
    const claudeSession = JSON.parse(readFileSync(sessionPath, "utf8"));
    await browser.command({
      type: "config.update",
      roles: {
        surveyor: { cli: "claude", model: "claude-sonnet-5-5" },
        modeler: { cli: "claude", model: "claude-opus-5-5" },
        designer: { cli: "codex", model: "gpt-5" },
      },
    });
    const { message } = await sendAndFinish({
      browser,
      projectId: project.id,
      text: "[fake:echo]",
    });
    expect(message?.status).toBe("done");
    const codexSession = JSON.parse(readFileSync(sessionPath, "utf8"));
    expect(codexSession.cli).toBe("codex");
    expect(codexSession.sessionId).not.toBe(claudeSession.sessionId);
    expect(
      readFileSync(
        join(
          fixture.env.PLANNER_PROJECTS,
          project.id,
          ".planner",
          "logs",
          "designer-1-2.jsonl",
        ),
        "utf8",
      ),
    ).toContain('"resume":false');
  } finally {
    await fixture.close();
  }
});

test("removing a project during a turn stops the turn and the daemon keeps running", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const project = await createProject(browser);
    await browser.command({
      type: "chat.send",
      projectId: project.id,
      text: "[fake:sleep]",
    });
    expect(
      await browser.command({ type: "project.remove", projectId: project.id }),
    ).toMatchObject({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await createProject(browser)).toMatchObject({ name: "Chat" });
  } finally {
    await fixture.close();
  }
});

test("a new session after a CLI switch gets the recent chat history in its prompt", async () => {
  const fixture = await createTestFixture({
    env: () => ({ PLANNER_FAKE_SCENARIO: "echo-prompt" }),
  });
  try {
    const browser = await fixture.connectBrowser();
    const project = await createProject(browser);
    const first = await sendAndFinish({
      browser,
      projectId: project.id,
      text: "The sofa is blue",
    });
    expect(first.message?.blocks).toStrictEqual([
      { kind: "text", markdown: "The sofa is blue" },
    ]);
    await browser.command({
      type: "config.update",
      roles: {
        surveyor: { cli: "claude", model: "claude-sonnet-5-5" },
        modeler: { cli: "claude", model: "claude-opus-5-5" },
        designer: { cli: "codex", model: "gpt-5" },
      },
    });
    const second = await sendAndFinish({
      browser,
      projectId: project.id,
      text: "Which colour is the sofa?",
    });
    expect(second.message?.blocks).toStrictEqual([
      {
        kind: "text",
        markdown: [
          "This is a new session. The recent conversation in this project was:",
          "",
          "User: The sofa is blue",
          "Designer: The sofa is blue",
          "",
          "The user's new message:",
          "Which colour is the sofa?",
        ].join("\n"),
      },
    ]);
    const third = await sendAndFinish({
      browser,
      projectId: project.id,
      text: "Thanks",
    });
    expect(third.message?.blocks).toStrictEqual([
      { kind: "text", markdown: "Thanks" },
    ]);
  } finally {
    await fixture.close();
  }
});

test("a missing CLI ends the turn with a notice that links to Settings", async () => {
  const fixture = await createTestFixture({
    env: (root) => ({ PLANNER_CLAUDE_BIN: `${root}/no-such-claude` }),
  });
  try {
    const browser = await fixture.connectBrowser();
    const project = await createProject(browser);
    const { event, message } = await sendAndFinish({
      browser,
      projectId: project.id,
      text: "hello",
    });
    expect(event).toMatchObject({ event: { status: "failed" } });
    expect(message?.blocks).toStrictEqual([
      {
        kind: "notice",
        text: "Claude Code is not installed on this Mac. Install it, then check again in Settings.",
        detail: {
          kind: "missing-requirement",
          settingsSection: "agents",
          setupFeature: "claude",
        },
      },
    ]);
  } finally {
    await fixture.close();
  }
});

test("a designer that adds a light to a lamp starts a bulb job for it", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const project = await createProject(browser);
    OkSchema.parse(
      await browser.command({
        type: "scene.apply",
        projectId: project.id,
        command: {
          type: "item.add",
          item: {
            id: "lamp",
            name: "Table lamp",
            model: { kind: "asset", assetId: "lamp-asset" },
            placement: {
              kind: "floor",
              xM: 0,
              zM: 0,
              elevationM: 0.7,
              rotationRad: 0,
            },
            sizeM: { width: 0.3, height: 0.5, depth: 0.3 },
            locked: false,
          },
        },
      }),
    );
    const { agentMessageId } = ChatSendResultSchema.parse(
      OkSchema.parse(
        await browser.command({
          type: "chat.send",
          projectId: project.id,
          text: "[fake:light-lamp] make the lamp a light",
        }),
      ).result,
    );
    expect(
      await browser.next(
        (value) =>
          z
            .object({
              type: z.literal("event"),
              event: z.object({
                kind: z.literal("job.updated"),
                job: z.object({
                  kind: z.literal("bulb"),
                  itemId: z.literal("lamp"),
                }),
              }),
            })
            .safeParse(value).success,
      ),
    ).toBeDefined();
    await browser.next(finished(agentMessageId));
  } finally {
    await fixture.close();
  }
});
