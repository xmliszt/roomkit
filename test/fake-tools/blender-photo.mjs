#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

if (process.argv.includes("--version")) {
  console.log("Blender 5.3.0");
} else {
  const path = process.argv.at(-1);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  console.log(
    `Fra:1 | Sample ${manifest.output.samples / 4}/${manifest.output.samples}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log(
    `Fra:1 | Sample ${(manifest.output.samples * 3) / 4}/${manifest.output.samples}`,
  );
  if (process.env.FAKE_RENDER_MODE === "hold")
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  else if (process.env.FAKE_RENDER_MODE === "oom") {
    console.error("Out of memory");
    process.exitCode = 1;
  } else {
    if (process.env.FAKE_RENDER_MODE === "fallback")
      console.error("GPU out of memory; retrying on CPU");
    const sharp = createRequire(
      new URL("../../packages/daemon/package.json", import.meta.url),
    )("sharp");
    const bytes = await sharp({
      create: {
        width: manifest.output.widthPx,
        height: manifest.output.heightPx,
        channels: 3,
        background: "#bb9988",
      },
    })
      .png()
      .toBuffer();
    writeFileSync(join(dirname(path), "render.png"), bytes);
    console.log(
      `Fra:1 | Sample ${manifest.output.samples}/${manifest.output.samples}`,
    );
  }
}
