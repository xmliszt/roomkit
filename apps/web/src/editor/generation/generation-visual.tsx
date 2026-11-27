import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { useReducedMotion } from "motion/react";
import { type ReactNode, Suspense, useEffect, useState } from "react";
import { AssetErrorBoundary } from "../scene/asset-error-boundary.tsx";
import type { AppearanceData } from "./appearance-data.ts";
import { AppearingAsset } from "./appearing-asset.tsx";
import { GeneratingPoints } from "./generating-points.tsx";
import type { getGenerationDisplays } from "./get-generation-displays.ts";
import { loadAppearanceData } from "./load-appearance-data.ts";

type GenerationVisualProps = {
  projectId: string;
  item: Item;
  display: ReturnType<typeof getGenerationDisplays>[number];
  assetReady: boolean;
  colors: { bg: string; ink: string; accent: string };
  pendingBox: ReactNode;
  onComplete: () => void;
};

export function GenerationVisual(props: GenerationVisualProps) {
  const reduced = useReducedMotion() === true;
  const assetId =
    props.item.model.kind === "asset" ? props.item.model.assetId : undefined;
  const [loaded, setLoaded] = useState<{
    assetId: string;
    data: AppearanceData;
  }>();
  const [failedAssetId, setFailedAssetId] = useState<string>();
  const canLoad = props.display.kind === "ready" && props.assetReady;
  const pendingVisual = (
    <>
      {props.pendingBox}
      {(props.display.kind === "generating" ||
        props.display.kind === "ready") &&
        !reduced && (
          <GeneratingPoints
            item={{ ...props.item, sizeM: props.display.sizeM }}
            progress={props.display.progress}
            accent={props.colors.accent}
          />
        )}
    </>
  );
  useEffect(() => {
    if (!assetId || !canLoad) return;
    const controller = new AbortController();
    void loadAppearanceData({
      projectId: props.projectId,
      assetId,
      signal: controller.signal,
    }).then(
      (data) => {
        if (!controller.signal.aborted) setLoaded({ assetId, data });
      },
      () => {
        if (!controller.signal.aborted) setFailedAssetId(assetId);
      },
    );
    return () => controller.abort();
  }, [assetId, canLoad, props.projectId]);
  useEffect(() => {
    if (assetId && failedAssetId === assetId) props.onComplete();
  }, [assetId, failedAssetId, props.onComplete]);
  if (canLoad && assetId && loaded?.assetId === assetId)
    return (
      <AssetErrorBoundary
        key={assetId}
        fallback={pendingVisual}
        onError={props.onComplete}
      >
        <Suspense fallback={pendingVisual}>
          <AppearingAsset
            projectId={props.projectId}
            item={props.item}
            assetId={assetId}
            sourceSizeM={props.display.sizeM}
            data={loaded.data}
            reduced={reduced}
            colors={props.colors}
            onComplete={props.onComplete}
          />
        </Suspense>
      </AssetErrorBoundary>
    );
  return pendingVisual;
}
