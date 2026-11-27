#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

const worker = basename(process.argv[2] ?? "", ".py");
if (!worker.startsWith("generate_")) {
  const child = spawn(
    new URL("b6/fake-python.mjs", import.meta.url),
    process.argv.slice(2),
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  const lock =
    process.env.PLANNER_MACHINE_LOCK ??
    join(process.env.HOME, ".cache/interior-planner-machine.lock");
  assert.ok(
    existsSync(join(lock, "holder")),
    "generation must hold the machine lock",
  );
  assert.ok(existsSync(request.photoPath));
  const sharp = createRequire(
    new URL("../packages/daemon/package.json", import.meta.url),
  )("sharp");
  const image = await sharp(request.photoPath).metadata();
  if (process.env.B11_WIDTH)
    assert.equal(image.width, Number(process.env.B11_WIDTH));
  if (process.env.B11_HEIGHT)
    assert.equal(image.height, Number(process.env.B11_HEIGHT));
  if (request.maskPath) {
    const mask = await sharp(request.maskPath).metadata();
    assert.equal(mask.width, image.width);
    assert.equal(mask.height, image.height);
  }
  if (request.maskPath) assert.ok(existsSync(request.maskPath));
  if (process.env.B11_CALLS)
    appendFileSync(
      process.env.B11_CALLS,
      `${JSON.stringify({ worker, ...request })}\n`,
    );
  process.stdout.write(
    `${JSON.stringify({ kind: "progress", stage: "inference", progress: 0.5 })}\n`,
  );
  const source = readFileSync(process.env.B11_ASSET);
  const length = source.readUInt32LE(12);
  const gltf = JSON.parse(source.subarray(20, 20 + length).toString("utf8"));
  const rotation = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  const isFlat =
    process.env.B11_CONTROL &&
    existsSync(process.env.B11_CONTROL) &&
    JSON.parse(readFileSync(process.env.B11_CONTROL, "utf8")).flat === true;
  for (const scene of gltf.scenes) {
    const root = gltf.nodes.length;
    gltf.nodes.push({ children: scene.nodes, rotation });
    scene.nodes = [root];
    if (isFlat) {
      gltf.nodes.push({ children: [root], scale: [1, 1, 0.001] });
      scene.nodes = [root + 1];
    }
  }
  const json = Buffer.from(JSON.stringify(gltf));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const binary = source.subarray(20 + length);
  const header = Buffer.alloc(20);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + binary.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.write("JSON", 16);
  mkdirSync(request.outputDir, { recursive: true });
  const glbPath = join(request.outputDir, "model.glb");
  writeFileSync(glbPath, Buffer.concat([header, padded, binary]));
  const result = {
    glbPath,
    sourceUp: "+Z",
    sourceFront: "-Y",
    model: worker === "generate_trellis" ? "trellis2" : "sam3d",
  };
  process.stdout.write(`${JSON.stringify({ kind: "result", result })}\n`);
}
