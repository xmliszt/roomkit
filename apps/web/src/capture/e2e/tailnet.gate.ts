import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { z } from "zod";

test("same-origin browser GETs through the tailnet proxy require the configured Tailscale login", async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), "planner-tailnet-browser-"));
  const proxy = fork(resolve("scripts/b12/tailnet-proxy.ts"), [root], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  try {
    const [ready] = await once(proxy, "message");
    const { port } = z
      .object({ type: z.literal("ready"), port: z.number() })
      .parse(ready);
    await page.goto(`http://127.0.0.1:${port}`);
    for (const entry of [
      { login: "planner@example.com", status: 200 },
      { login: undefined, status: 403 },
      { login: "wrong@example.test", status: 403 },
    ]) {
      const updated = once(proxy, "message");
      proxy.send({ login: entry.login });
      await updated;
      const response = await page.evaluate(async () => {
        const response = await fetch("/daemon/catalog/charging-port/thumb.png");
        return {
          status: response.status,
          bytes: (await response.arrayBuffer()).byteLength,
        };
      });
      expect(response.status).toBe(entry.status);
      expect(response.bytes).toBeGreaterThan(0);
      const headers = await page.evaluate(() =>
        fetch("/received").then((response) => response.json()),
      );
      expect(headers.origin).toBeUndefined();
      expect(headers["sec-fetch-site"]).toBe("same-origin");
    }
  } finally {
    if (proxy.exitCode === null && proxy.signalCode === null) {
      const closed = once(proxy, "exit");
      proxy.kill("SIGTERM");
      await closed;
    }
    await rm(root, { recursive: true, force: true });
  }
});
