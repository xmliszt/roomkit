import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { exec } from "../util/exec.ts";
import { openAgentLogin } from "./open-agent-login.ts";

vi.mock("../util/exec.ts", () => ({ exec: vi.fn() }));

it.skipIf(process.platform !== "darwin")(
  "creates the Codex home and uses it in the launcher and fallback command",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "roomkit-login-test-"));
    const codexHome = join(root, "codex");
    const codexPath = fileURLToPath(
      new URL("../../../../test/fake-cli/codex", import.meta.url),
    );
    const env = { CODEX_HOME: codexHome, PLANNER_CODEX_BIN: codexPath };
    vi.mocked(exec).mockImplementation(async ({ command, args }) => {
      expect(command).toBe("/usr/bin/open");
      const [flag, app, launcher] = args;
      expect([flag, app]).toEqual(["-a", "Terminal"]);
      if (!launcher) throw new Error("Missing Terminal launcher");
      expect(statSync(codexHome).isDirectory()).toBe(true);
      expect(execFileSync(launcher, { encoding: "utf8" })).toContain(
        "Logged in using ChatGPT",
      );
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    });
    try {
      await openAgentLogin({ cli: "codex", env });
      vi.mocked(exec).mockResolvedValueOnce({
        code: 1,
        stdout: "",
        stderr: "",
        timedOut: false,
      });
      await expect(openAgentLogin({ cli: "codex", env })).rejects.toThrow(
        `Could not open Terminal. Run CODEX_HOME='${codexHome}' '${codexPath}' login on this Mac.`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
