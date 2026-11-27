import { createContext, type RefObject } from "react";
import type { createAssetPreviewRenderer } from "./create-asset-preview-renderer.ts";

export const AssetPreviewContext = createContext<
  | RefObject<ReturnType<typeof createAssetPreviewRenderer> | undefined>
  | undefined
>(undefined);
