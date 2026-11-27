#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const worker = basename(process.argv[2] ?? "", ".py");
const callsPath = process.env.B17_CALLS;
if (callsPath)
  appendFileSync(callsPath, `${JSON.stringify({ worker, ...request })}\n`);
const calls = callsPath
  ? readFileSync(callsPath, "utf8").trim().split("\n").map(JSON.parse)
  : [];
const trellisCalls = calls.filter((call) => call.worker === "generate_trellis");
const mode = process.env.B17_MODE;
if (
  worker === "generate_trellis" &&
  (mode === "stall" || (mode === "stall-once" && trellisCalls.length === 1))
) {
  process.stdout.write(
    `${JSON.stringify({ kind: "progress", stage: "export", progress: 0.9 })}\n`,
  );
  await delay(60_000);
  process.exit(1);
}
if (mode === "user-error") {
  process.stdout.write(
    `${JSON.stringify({ kind: "error", message: "Could not find the Sofa in the reference photo", isUserFacing: true })}\n`,
  );
  process.exit(1);
}
if (mode === "error" || mode === "raw-error") {
  process.stdout.write(
    `${JSON.stringify({ kind: "error", message: mode === "error" ? "invalid reference" : 'RESULT {"raw":"private worker diagnostic"}' })}\n`,
  );
  process.exit(1);
}
const runMs = Number(process.env.B17_RUN_MS ?? 0);
if (mode === "progress" || mode === "heartbeat") {
  for (let elapsedMs = 0; elapsedMs < runMs; elapsedMs += 100) {
    process.stdout.write(
      `${JSON.stringify({ kind: "progress", stage: mode === "progress" ? "sampling" : "running" })}\n`,
    );
    await delay(100);
  }
} else await delay(runMs);
if (process.env.B11_ASSET) {
  const child = spawn(
    fileURLToPath(
      new URL("../../../../scripts/b11-fake-python.mjs", import.meta.url),
    ),
    process.argv.slice(2),
    {
      env: process.env,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  child.stdin.end(input);
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  if (
    process.env.PLANNER_MACHINE_LOCK &&
    !existsSync(join(process.env.PLANNER_MACHINE_LOCK, "holder"))
  )
    throw new Error("Worker ran without the machine lock");
  mkdirSync(request.outputDir, { recursive: true });
  const glbPath = join(request.outputDir, "model.glb");
  writeFileSync(glbPath, "fake glb");
  process.stdout.write(
    `${JSON.stringify({
      kind: "result",
      result: {
        glbPath,
        sourceUp: "+Z",
        sourceFront: "-Y",
        model: worker === "generate_trellis" ? "trellis2" : "sam3d",
      },
    })}\n`,
  );
}
