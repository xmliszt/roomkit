import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(tmpdir(), "planner-b12-serve-"));
const state = join(root, "serve.json");
const host = "roomkit-host.example-tailnet.ts.net";
const existing = {
  TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } },
  Web: {
    [`${host}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:4800" } } },
    [`${host}:8443`]: {
      Handlers: { "/other": { Proxy: "http://127.0.0.1:9000" } },
    },
  },
};
try {
  writeFileSync(state, JSON.stringify(existing));
  writeFileSync(
    join(root, "tailscale"),
    `#!${process.execPath}
const fs = require("node:fs");
const assert = require("node:assert/strict");
const args = process.argv.slice(2);
if (args[0] === "status") {
  assert.deepEqual(args, ["status", "--json"]);
  process.stdout.write(JSON.stringify({ Self: { DNSName: "${host}." } }));
  process.exit(0);
}
assert.equal(args[0], "serve");
const state = process.env.B12_SERVE_STATE;
const config = JSON.parse(fs.readFileSync(state, "utf8"));
if (args[1] === "status") {
  process.stdout.write(JSON.stringify(config));
} else {
  assert.ok(args.includes("--https=8443"));
  assert.ok(args.includes("--yes"));
  const mount = args.find((arg) => arg.startsWith("--set-path=")).slice(11);
  assert.ok(["/", "/daemon"].includes(mount));
  const handlers = config.Web["${host}:8443"].Handlers;
  if (args.at(-1) === "off") delete handlers[mount];
  else {
    assert.ok(args.includes("--bg"));
    handlers[mount] = { Proxy: args.at(-1) };
  }
  fs.writeFileSync(state, JSON.stringify(config));
}
`,
    { mode: 0o755 },
  );
  const env = { PATH: `${root}:${process.env.PATH}`, B12_SERVE_STATE: state };
  const script = resolve("scripts/tailnet-serve.sh");
  const first = execFileSync(script, { env, encoding: "utf8" });
  assert.ok(first.includes(`https://${host}:8443`));
  const configured = readFileSync(state, "utf8");
  execFileSync(script, { env });
  assert.equal(readFileSync(state, "utf8"), configured, "setup is idempotent");
  const enabled = JSON.parse(configured);
  assert.deepEqual(enabled.Web[`${host}:8443`].Handlers, {
    ...existing.Web[`${host}:8443`].Handlers,
    "/": { Proxy: "http://127.0.0.1:3210" },
    "/daemon": { Proxy: "http://127.0.0.1:4820" },
  });
  assert.deepEqual(enabled.Web[`${host}:443`], existing.Web[`${host}:443`]);
  execFileSync(script, ["off"], { env });
  execFileSync(script, ["off"], { env });
  assert.deepEqual(JSON.parse(readFileSync(state, "utf8")), existing);
  process.stdout.write(
    "B12 serve gate passed: setup/off idempotent; 443 and other entries preserved\n",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
