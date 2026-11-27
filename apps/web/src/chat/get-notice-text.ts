import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import type { MessageTranslator } from "../i18n/message-translator.ts";

export function getNoticeText(options: {
  block: Extract<ChatBlock, { kind: "notice" }>;
  t: MessageTranslator;
}) {
  const { detail, text } = options.block;
  const t = options.t;

  switch (detail.kind) {
    case "missing-requirement": {
      const agent =
        /^(Claude Code|Codex) is not (installed on this Mac\. Install it|signed in\. Sign in), then check again in Settings\.$/.exec(
          text,
        );
      if (detail.settingsSection === "agents" && agent?.[1]) {
        return t(
          agent[2]?.startsWith("installed")
            ? "chat.notice.install-agent"
            : "chat.notice.sign-in",
          { agent: agent[1] },
        );
      }
      const model =
        /^This step needs the (.+) weights\. Download them in Settings\.$/.exec(
          text,
        )?.[1];
      if (detail.settingsSection === "python" && model) {
        return t("chat.notice.download-model", { model });
      }
      switch (text) {
        case "This step needs Blender. Install it or pick its path in Settings.":
          return t("chat.notice.install-blender");
        case "This step needs uv. Install it in Settings.":
          return t("chat.notice.install-uv");
        case "This step needs the Python env. Create it in Settings.":
          return t("chat.notice.set-up-python");
        default:
          return text;
      }
    }
    case "usage-limit":
      return text === "The usage limit was reached."
        ? t("chat.notice.usage-limit")
        : text;
    case "error":
      switch (text) {
        case "The agent stopped answering and was stopped after 15 minutes.":
          return t("chat.notice.agent-timeout");
        case "The agent turn failed.":
          return t("chat.notice.agent-failed");
        default:
          return text;
      }
  }
}
