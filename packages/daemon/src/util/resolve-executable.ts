import { accessSync, constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";

export function resolveExecutable(options: {
  command: string;
  env: NodeJS.ProcessEnv;
}) {
  const command =
    options.command.startsWith("~/") && options.env.HOME
      ? join(options.env.HOME, options.command.slice(2))
      : options.command;
  if (command.includes("/")) return resolve(command);
  return (
    [
      ...(options.env.PATH ?? "").split(delimiter).filter(Boolean),
      ...(options.env.HOME ? [join(options.env.HOME, ".local/bin")] : []),
      ...(process.platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    ]
      .map((directory) => resolve(directory, command))
      .find((path) => {
        try {
          accessSync(path, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      }) ?? command
  );
}
