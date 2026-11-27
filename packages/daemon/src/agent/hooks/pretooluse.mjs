#!/usr/bin/env node

import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function globToRegex(glob) {
  const p = glob.replace(/^\/+/, "");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        re += ".*";
        i++;
        if (p[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function deny(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

const payload = (() => {
  try {
    return JSON.parse(readStdin());
  } catch {
    return {};
  }
})();

const tool = payload.tool_name ?? "";
const input = payload.tool_input ?? {};
const cwd = payload.cwd ?? process.cwd();
const project = process.env.PLANNER_PROJECT ?? cwd;
const writeRoot = process.env.PLANNER_WRITE_ROOT;

const protectedPaths = ["project.json", ".planner", ".planner/**"];

if (process.env.PLANNER_READ_ONLY === "1") {
  const allowed = JSON.parse(process.env.PLANNER_TOOL_ALLOWLIST ?? "[]");
  if (!allowed.includes(tool)) deny(`Tool is not allowed: ${tool}`);
}

if (tool === "Read" && process.env.PLANNER_READ_ROOT !== undefined) {
  try {
    const path = input.file_path;
    if (typeof path !== "string") deny("Planner: Read needs a file_path");
    const target = realpathSync(resolve(cwd, path));
    const inside = relative(
      realpathSync(process.env.PLANNER_READ_ROOT),
      target,
    );
    if (
      inside === "" ||
      inside.startsWith("..") ||
      isAbsolute(inside) ||
      !statSync(target).isFile()
    )
      deny("Planner: read outside the photo copies folder");
  } catch {
    deny("Planner: photo copy is not readable");
  }
}

if (
  ["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"].includes(tool)
) {
  const files =
    tool === "apply_patch"
      ? [
          ...String(input.command ?? "").matchAll(
            /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm,
          ),
        ].map((match) => match[1])
      : [input.file_path ?? input.path ?? input.notebook_path ?? ""];
  for (const path of files) {
    const target = resolve(cwd, path);
    if (writeRoot !== undefined) {
      const inside = relative(resolve(writeRoot), target);
      if (inside.startsWith("..") || isAbsolute(inside))
        deny(`Planner: write outside the job folder: ${path}`);
    }
    const file = relative(project, target);
    for (const pattern of protectedPaths) {
      if (globToRegex(pattern).test(file)) {
        deny(
          `Planner: "${file}" is a PROTECTED PATH (matches "${pattern}"). Change the scene through scene_apply.`,
        );
      }
    }
  }
}

process.exit(0);
