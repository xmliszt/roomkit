#!/usr/bin/env node
import { copyFileSync } from "node:fs";

const index = process.argv.indexOf("--output");
const output = process.argv.at(index + 1);
if (!output || !process.env.B10_ALTERNATIVE_ASSET)
  throw new Error("Missing alternative fixture paths");
copyFileSync(process.env.B10_ALTERNATIVE_ASSET, output);
process.stdout.write("Alternative fixture written\n");
