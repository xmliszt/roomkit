import type { Size } from "@planner/shared/src/scene/size-schema.ts";

export type GenerationEntry = {
  itemId: string;
  jobId: string;
  sizeM: Size;
  isActive: boolean;
};
