import { checkCodingAgents } from "./check-coding-agents.ts";

export function createCodingAgentChecker(
  options: Parameters<typeof checkCodingAgents>[0] & {
    now?: () => number;
  } = {},
) {
  const now = options.now ?? Date.now;
  let cached: ReturnType<typeof checkCodingAgents> | undefined;
  let expiresAtMs = 0;
  return {
    check(input: { force?: boolean } = {}) {
      if (!cached || input.force || now() >= expiresAtMs) {
        expiresAtMs = now() + 30_000;
        cached = checkCodingAgents(options).catch((error: unknown) => {
          cached = undefined;
          throw error;
        });
      }
      return cached;
    },
  };
}
