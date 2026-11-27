import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("uv 0.13.9 (fake)");
  process.exit(0);
}
function value(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
const project = value("--project");
const environment = process.env.UV_PROJECT_ENVIRONMENT;
if (
  args[0] !== "sync" ||
  !args.includes("--frozen") ||
  !project ||
  !environment
) {
  console.error(
    `fake uv: expected sync --project <dir> --frozen with UV_PROJECT_ENVIRONMENT, got ${args.join(" ")}`,
  );
  process.exit(2);
}
if (
  !existsSync(join(project, "pyproject.toml")) ||
  !existsSync(join(project, "uv.lock"))
) {
  console.error(`fake uv: ${project} has no pyproject.toml and uv.lock`);
  process.exit(2);
}
console.error("Using CPython 3.13.18");
console.error(`Creating virtual environment at: ${environment}`);
await delay(20);
console.error("Resolved 92 packages in 4ms");
console.error("Installed 22 packages in 120ms");
mkdirSync(join(environment, "bin"), { recursive: true });
const python = join(environment, "bin", "python");
writeFileSync(
  python,
  '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Python 3.13.18"; exit 0; fi\nexit 2\n',
);
chmodSync(python, 0o755);
writeFileSync(join(environment, "pyvenv.cfg"), "version_info = 3.13.18\n");
