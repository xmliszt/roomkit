import type { CodingAgentStatus } from "@planner/shared/src/agents/coding-agent-status-schema.ts";
import type { MessageTranslator } from "../i18n/message-translator.ts";

export function translateUsageDiagnostic(options: {
  cli: CodingAgentStatus["cli"];
  error: NonNullable<NonNullable<CodingAgentStatus["usage"]>["error"]>;
  t: MessageTranslator;
}) {
  const { cli, error, t } = options;
  const name = cli === "claude" ? "Claude" : "Codex";
  switch (error.kind) {
    case "not-signed-in":
      if (
        error.message ===
        "Usage needs a ChatGPT sign-in (codex login). API-key sign-ins do not report plan limits."
      ) {
        return t("settings.usageApiSignIn", { command: "codex login" });
      }
      if (
        error.message ===
        "Usage needs a claude.ai sign-in (run claude and log in). API-key sign-ins do not report plan limits."
      ) {
        return t("settings.usageApiSignIn", { command: "claude" });
      }
      break;
    case "refused":
      if (
        error.message ===
          "The stored Codex sign-in was refused. Run any codex command once to refresh it, then check again." ||
        error.message ===
          "The stored Claude sign-in was refused. Run claude once to refresh it, then check again."
      ) {
        return t("settings.usageRefreshSignIn", { command: cli });
      }
      if (
        error.message ===
        "This Claude sign-in cannot report usage. Sign out and in again with claude to grant it."
      ) {
        return t("settings.usageGrantScope", { command: "claude" });
      }
      break;
    case "rate-limited":
      if (
        error.message ===
        `${name} usage is rate limited (HTTP 429). Check again later.`
      ) {
        return t("settings.usageRateLimited", { agent: name });
      }
      break;
    case "http-status": {
      const [, provider, status] =
        /^(Claude|Codex) usage is unavailable right now \(HTTP (\d{3})\)\.$/.exec(
          error.message,
        ) ?? [];
      if (provider === name && status) {
        return t("settings.usageHttpUnavailable", { agent: name, status });
      }
      break;
    }
    case "changed-shape":
      if (
        error.message ===
        `${name} usage answered in a form this app does not know.`
      ) {
        return t("settings.usageUnknownResponse", { agent: name });
      }
      break;
    case "timeout":
      if (error.message === "The usage request timed out. Check again later.") {
        return t("settings.usageTimedOut");
      }
      break;
    case "failed":
      if (error.message === "Usage check failed.") {
        return t("settings.usageCheckFailed");
      }
      break;
    default: {
      const unreachable: never = error.kind;
      return unreachable;
    }
  }
  return t("settings.usageUnavailable", { detail: error.message });
}
