import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { on, once } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { daemonPort, webPort } from "./ports.mjs";

const [resources, launch] = process.argv.slice(2);
assert(
  launch === "fresh" || launch === "reopened",
  "Expected fresh or reopened launch",
);
const origin = `http://127.0.0.1:${webPort}`;
const daemon = `http://127.0.0.1:${daemonPort}`;
const selectedPreference = { kind: "selected", locale: "fr" };
const require = createRequire(
  pathToFileURL(join(resources, "runtime/packages/daemon/package.json")),
);
const WebSocket = require("ws");

async function verifyPage(path) {
  const response = await fetch(`${origin}${path}`, {
    signal: AbortSignal.timeout(10000),
  });
  assert(response.ok, `Page returned HTTP ${response.status}: ${path}`);
  const html = await response.text();
  assert(
    html.includes("Connecting to Roomkit…"),
    `Missing connection status on ${path}`,
  );
  const script = /src="(\/_next\/static\/[^"]+\.js)"/.exec(html)?.at(1);
  assert(script, `Missing client script on ${path}`);
  const bundle = await fetch(`${origin}${script}`, {
    signal: AbortSignal.timeout(10000),
  });
  assert(bundle.ok, `Static asset returned HTTP ${bundle.status}: ${script}`);
  await bundle.body?.cancel();
}

const socket = new WebSocket(`ws://127.0.0.1:${daemonPort}/ws`, {
  origin,
  handshakeTimeout: 5000,
});

async function command(input) {
  const requestId = randomUUID();
  socket.send(JSON.stringify({ ...input, requestId }));
  for await (const [data] of on(socket, "message", {
    close: ["close"],
    signal: AbortSignal.timeout(10000),
  })) {
    const message = JSON.parse(data.toString());
    if (message.type !== "command.ack" || message.requestId !== requestId)
      continue;
    if (!message.ok) throw new Error(message.error);
    return message.result;
  }
  throw new Error(`Roomkit closed the connection during ${input.type}.`);
}

try {
  await once(socket, "open");
  assert.deepEqual(
    await command({ type: "language.get" }),
    launch === "fresh" ? { kind: "pending" } : selectedPreference,
    `Unexpected language preference on ${launch} launch`,
  );
  if (launch === "fresh") {
    assert.deepEqual(
      await command({
        type: "language.set",
        locale: selectedPreference.locale,
      }),
      selectedPreference,
    );
    const nativeMessages = JSON.parse(
      await readFile(join(resources, "native-messages.json"), "utf8"),
    );
    assert(
      nativeMessages[selectedPreference.locale],
      "Missing packaged native locale",
    );
  }
  const project = await command({ type: "project.sample.open" });
  assert.deepEqual(
    project.scene.items.map((item) => item.model.assetId).toSorted(),
    [
      "sample-chair",
      "sample-lamp",
      "sample-rug",
      "sample-sofa",
      "sample-table",
    ],
  );
  assert.equal(
    project.scene.items.find((item) => item.id === "lamp")?.light?.on,
    false,
  );
  await verifyPage("/");
  await verifyPage("/settings");
  await verifyPage(`/projects/${project.id}`);
  for (const item of project.scene.items) {
    const assetId = item.model.assetId;
    const model = await fetch(
      `${daemon}/projects/${project.id}/assets/${assetId}/model.glb`,
      {
        headers: { Origin: origin },
        signal: AbortSignal.timeout(10000),
      },
    );
    assert(model.ok, `Model returned HTTP ${model.status}: ${assetId}`);
    assert.equal(
      Buffer.from(await model.arrayBuffer()).toString("ascii", 0, 4),
      "glTF",
    );
  }
  process.stdout.write(`${project.id}\n`);
} finally {
  socket.terminate();
}
