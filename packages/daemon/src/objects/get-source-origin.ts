import type { GenerationRecord } from "../generation/generation-record-schema.ts";

export function getSourceOrigin(options: {
  source: GenerationRecord["source"] | undefined;
  isCatalog?: boolean;
  isVariant?: boolean;
}) {
  if (options.isCatalog) return "catalog";
  if (options.isVariant) return "variant";
  switch (options.source?.kind) {
    case "photo":
      return "chat-photo";
    case "inventory":
      return "inventory";
    case "web":
      return "web";
    case "shape":
    case "color":
      return "variant";
    case undefined:
      return "prompt";
    default: {
      const unreachable: never = options.source;
      return unreachable;
    }
  }
}
