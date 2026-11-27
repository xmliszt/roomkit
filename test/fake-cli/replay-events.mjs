#!/usr/bin/env node
import { runFakeCli } from "./run-fake-cli.mjs";

const kind = process.argv.at(2) === "exec" ? "codex" : "claude";
if (process.argv.includes("--version") || process.argv.includes("--help")) {
  await runFakeCli({ kind });
} else {
  let prompt = "";
  for await (const chunk of process.stdin) prompt += chunk;
  const input = JSON.parse(prompt);
  for (const item of input.events) {
    if (item.delayMs)
      await new Promise((resolve) => setTimeout(resolve, item.delayMs));
    if (item.stderr) process.stderr.write(item.stderr);
    else process.stdout.write(`${JSON.stringify(item.event)}\n`);
  }
}
