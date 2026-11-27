import type { Config, Role } from "./config-schema.ts";

export function createDefaultConfig(
  cli: Config["roles"][Role]["cli"] = "claude",
): Config {
  const defaultModel = cli === "claude" ? "claude-sonnet-5-5" : "gpt-6.1-sol";
  return {
    version: 1,
    roles: {
      surveyor: { cli, model: defaultModel },
      modeler: {
        cli,
        model: cli === "claude" ? "claude-opus-5-5" : defaultModel,
      },
      designer: { cli, model: defaultModel },
    },
  };
}
