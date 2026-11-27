import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isMissingPathError } from "../util/is-missing-path-error.ts";

const exec = promisify(execFile);
const macCli = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

export function createTailscaleCli(options: {
  env: NodeJS.ProcessEnv;
  packaged?: boolean;
  executable?: string;
}) {
  const executable =
    options.executable ?? (options.packaged ? macCli : "tailscale");
  return async (args: string[]) => {
    const run = (binary: string) =>
      exec(binary, args, {
        env: { ...options.env, TAILSCALE_BE_CLI: "1" },
        timeout: 2500,
        maxBuffer: 4 * 1024 * 1024,
        killSignal: "SIGKILL",
      });
    try {
      return (await run(executable)).stdout;
    } catch (error) {
      if (
        options.executable ||
        executable !== macCli ||
        !isMissingPathError(error)
      )
        throw error;
      return (await run("tailscale")).stdout;
    }
  };
}
