import type { GenerationRecord } from "./generation-record-schema.ts";

const maxOpeningDepthM = 0.25;

export function getGenerationTargetSize(record: GenerationRecord) {
  if (record.source.kind === "color") return record.source.nativeSizeM;
  const sizeM = record.item.sizeM;
  return record.item.cutsOpening
    ? { ...sizeM, depth: Math.min(sizeM.depth, maxOpeningDepthM) }
    : sizeM;
}
