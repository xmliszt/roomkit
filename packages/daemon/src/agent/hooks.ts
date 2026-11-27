import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeJson } from "../util/write-json.ts";

export const HOOK_SCRIPT_PATH = join(
  import.meta.dirname,
  "hooks",
  "pretooluse.mjs",
);

export function writeHookSettings(options: { dir: string }) {
  mkdirSync(options.dir, { recursive: true });
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const path = join(options.dir, "hooks.json");
  writeJson({
    path,
    value: {
      hooks: {
        PreToolUse: [
          {
            matcher: ".*",
            hooks: [
              {
                type: "command",
                command: `${quote(process.execPath)} ${quote(HOOK_SCRIPT_PATH)}`,
              },
            ],
          },
        ],
      },
    },
  });
  return path;
}
