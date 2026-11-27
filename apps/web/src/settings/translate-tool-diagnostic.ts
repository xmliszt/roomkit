import type { ToolCheck } from "@planner/shared/src/preflight/preflight-schema.ts";
import type { MessageTranslator } from "../i18n/message-translator.ts";

export function translateToolDiagnostic(options: {
  check: ToolCheck | undefined;
  tool: "Python" | "Blender" | "uv";
  t: MessageTranslator;
}) {
  const { check, tool, t } = options;
  if (!check) return t("settings.notChecked");
  switch (check.message) {
    case `${tool} is not installed.`:
      return t("settings.toolNotInstalled", { tool });
    case `${tool} --version timed out.`:
      return t("settings.commandTimedOut", { command: `${tool} --version` });
    case `${tool} at this path did not report a version.`:
      return t("settings.toolVersionUnavailable", { tool });
    case "The Python env is not created.":
      return t("settings.pythonMissing");
    case `The Python env has Python ${check.version}; it needs 3.13. Create it again.`:
      return t("settings.pythonVersionMismatch", {
        version: check.version ?? "",
      });
    case "The Python env is incomplete. Create it again.":
    case "The Python env is older than uv.lock. Create it again.":
      return t("settings.pythonRecreate");
    default:
      return check.state === "error"
        ? t("settings.toolCheckFailed", { tool, detail: check.message })
        : check.message;
  }
}
