import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function steps({ prompt }) {
  const paths = JSON.parse(prompt.trim().split("\n").at(-1));
  assert.ok(Array.isArray(paths) && paths.length > 0);
  const args = process.argv.slice(2);
  const hook = fileURLToPath(
    new URL(
      "../../../packages/daemon/src/agent/hooks/pretooluse.mjs",
      import.meta.url,
    ),
  );
  function read(path) {
    return spawnSync(process.execPath, [hook], {
      env: process.env,
      input: JSON.stringify({
        tool_name: "Read",
        tool_input: { file_path: path },
        cwd: process.cwd(),
      }),
      encoding: "utf8",
    });
  }
  for (const path of paths) {
    if (args.includes("exec")) {
      assert.ok(
        args.some(
          (arg, index) => arg === "--image" && args.at(index + 1) === path,
        ),
      );
    } else {
      assert.ok(
        args
          .at(args.indexOf("--tools") + 1)
          .split(",")
          .includes("Read"),
      );
      assert.equal(read(path).status, 0);
    }
    assert.equal(readFileSync(path).subarray(0, 2).toString("hex"), "ffd8");
  }
  assert.equal(read(join(process.cwd(), "project.json")).status, 2);
  return [
    {
      kind: "tool",
      name: "chat_post",
      arguments: {
        blocks: [
          {
            kind: "choice",
            choiceId: "photo-purpose",
            question:
              "Add the object or use it as a reference for the selected object?",
            options: [
              { id: "add", label: "Add the object" },
              { id: "reference", label: "Use as reference" },
            ],
          },
        ],
      },
    },
    { kind: "text", text: `Inspected ${paths.length} photos.` },
  ];
}
