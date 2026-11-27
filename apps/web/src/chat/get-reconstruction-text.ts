import type { MessageTranslator } from "../i18n/message-translator.ts";

export function getReconstructionText(options: {
  text: string;
  t: MessageTranslator;
}) {
  const { t, text } = options;
  if (
    text ===
    "The room uses the model's scale. Check width, depth and ceiling height in the room panel."
  ) {
    return t("chat.reconstruction.estimated-scale");
  }
  const measurements =
    /^Scale sources differ by more than 5%: (.+)\. Check these measurements\.$/s.exec(
      text,
    )?.[1];
  if (measurements) {
    return t("chat.reconstruction.scale-disagreement", { measurements });
  }
  const detail =
    /^Reconstruction failed: (.+)\. Enter width, depth and ceiling height in the room panel\.$/s.exec(
      text,
    )?.[1];
  if (detail) return t("chat.reconstruction.failed", { detail });
}
