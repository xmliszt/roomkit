import { spawn } from "node:child_process";
import { join } from "node:path";

async function run(options: { command: string; args: string[] }) {
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0)
    throw new Error(`B21 check failed (${code}): ${options.args.join(" ")}`);
}

const heartbeat = setInterval(
  () => console.log("gate:b21: checking photo rendering"),
  5000,
);
try {
  await run({
    command: "pnpm",
    args: ["exec", "vitest", "run", "packages/daemon/src/render"],
  });
  const evidence = process.env.PLANNER_B21_EVIDENCE_DIR;
  if (evidence) {
    for (const mode of ["walk", "orbit"])
      await run({
        command: process.execPath,
        args: [
          "scripts/b21-check-look.ts",
          join(evidence, `b21-${mode}.png`),
          join(evidence, `b21-${mode}-editor.png`),
          join(evidence, `b21-${mode}.json`),
        ],
      });
    await run({
      command: process.execPath,
      args: ["scripts/b21-check-lamps.ts", evidence],
    });
  }
  process.stdout.write("B21 gate: PASS\n");
} finally {
  clearInterval(heartbeat);
}
