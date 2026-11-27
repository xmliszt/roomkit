import type { CodingAgentStatus } from "@planner/shared/src/agents/coding-agent-status-schema.ts";
import type { MessageTranslator } from "../i18n/message-translator.ts";

export function translateAgentDiagnostic(options: {
  agent: CodingAgentStatus;
  t: MessageTranslator;
}) {
  const { agent, t } = options;
  const name = agent.cli === "claude" ? "Claude Code" : "Codex";
  const message = agent.message;
  if (message === `${name} is not installed on this Mac.`) {
    return t("settings.agentMissingHint", { agent: name });
  }
  if (message === "Installed. Sign in on this Mac, then check again.") {
    return t("settings.agentSignInHint");
  }
  if (
    message ===
    "Update Codex CLI to a version with isolated configuration and hook support, then check again."
  ) {
    return t("settings.agentUpgradeCodex");
  }
  if (
    message === `${name} --version timed out. Try checking again.` ||
    message === "codex exec --help timed out. Try checking again."
  ) {
    return t("settings.commandTimedOut", {
      command:
        message === "codex exec --help timed out. Try checking again."
          ? "codex exec --help"
          : `${name} --version`,
    });
  }
  if (message === "Sign-in check timed out. Try checking again.") {
    return t("settings.signInCheckTimedOut");
  }
  if (
    message ===
    "The coding agent did not respond. Check its installation, then try again."
  ) {
    return t("settings.agentRespondFailed");
  }
  if (message === "Coding agent check failed.") {
    return t("settings.agentRespondFailed");
  }
  return agent.status === "error"
    ? t("settings.agentCheckFailed", { detail: message })
    : message;
}
