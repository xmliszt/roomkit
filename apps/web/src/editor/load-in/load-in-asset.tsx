import type { AssetMeta } from "@planner/shared/src/scene/asset-meta-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { useReducedMotion } from "motion/react";
import {
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Group, Object3D } from "three";
import type { AppearanceData } from "../generation/appearance-data.ts";
import { AppearingAsset } from "../generation/appearing-asset.tsx";
import { loadAppearanceData } from "../generation/load-appearance-data.ts";
import { AssetErrorBoundary } from "../scene/asset-error-boundary.tsx";
import { AssetModel } from "../scene/asset-model.tsx";
import { clearAssetCache } from "../scene/clear-asset-cache.ts";
import { isFloorCovering } from "../scene/is-floor-covering.ts";
import { createCatalogAppearanceData } from "./create-catalog-appearance-data.ts";
import type { createLoadIn } from "./create-load-in.ts";
import { useLoadInEntry } from "./use-load-in-entry.ts";

const sidecarTimeoutMs = 15000;
type DataState =
  | { kind: "loading" }
  | { kind: "ready"; data: AppearanceData }
  | { kind: "fade" }
  | { kind: "released" };
type ModelResource = {
  meta: AssetMeta;
  model: Object3D;
  creases: number[];
  readyAtMs: number;
};
type LoadInAssetProps = {
  projectId: string;
  item: Item;
  assetId: string;
  loadIn: ReturnType<typeof createLoadIn>;
  colors: { bg: string; ink: string; accent: string };
  fallback: ReactNode;
};

export function LoadInAsset(props: LoadInAssetProps) {
  const reduced = useReducedMotion() === true;
  const [resource, setResource] = useState<ModelResource>();
  const [sidecars, setSidecars] = useState<DataState>({ kind: "loading" });
  const groupRef = useRef<Group>(null);
  const entry = useLoadInEntry({ loadIn: props.loadIn, itemId: props.item.id });
  const done = entry?.kind === "done";
  const handleReady = useCallback(
    (loaded: Omit<ModelResource, "readyAtMs">) => {
      setResource({ ...loaded, readyAtMs: performance.now() });
    },
    [],
  );

  useEffect(() => {
    if (resource || done) return;
    const timeout = window.setTimeout(
      () => props.loadIn.complete(props.item.id),
      sidecarTimeoutMs,
    );
    return () => window.clearTimeout(timeout);
  }, [resource, done, props.loadIn, props.item.id]);

  useEffect(() => {
    if (done) {
      setSidecars({ kind: "released" });
      return;
    }
    if (!resource) return;
    if (reduced) {
      setSidecars({ kind: "fade" });
      props.loadIn.ready({
        itemId: props.item.id,
        readyAtMs: resource.readyAtMs,
      });
      return;
    }
    let active = true;
    void props.loadIn
      .loadData({
        assetId: props.assetId,
        load: async () =>
          resource.meta.kind === "catalog"
            ? createCatalogAppearanceData(resource)
            : loadAppearanceData({
                projectId: props.projectId,
                assetId: props.assetId,
                signal: AbortSignal.timeout(sidecarTimeoutMs),
              }),
      })
      .then(
        (data) => {
          if (!active) return;
          setSidecars({ kind: "ready", data });
          props.loadIn.ready({
            itemId: props.item.id,
            readyAtMs: resource.readyAtMs,
          });
        },
        () => {
          if (!active) return;
          setSidecars({ kind: "fade" });
          props.loadIn.ready({
            itemId: props.item.id,
            readyAtMs: resource.readyAtMs,
          });
        },
      );
    return () => {
      active = false;
    };
  }, [
    props.loadIn,
    props.projectId,
    props.assetId,
    props.item.id,
    reduced,
    resource,
    done,
  ]);

  return (
    <AssetErrorBoundary
      fallback={props.fallback}
      onError={() => {
        clearAssetCache({ projectId: props.projectId, assetId: props.assetId });
        props.loadIn.complete(props.item.id);
      }}
    >
      <Suspense fallback={done ? props.fallback : null}>
        <group ref={groupRef} visible={done}>
          <AssetModel
            projectId={props.projectId}
            assetId={props.assetId}
            sizeM={props.item.sizeM}
            colorAdjust={props.item.colorAdjust}
            castShadow={!props.item.light?.on}
            shade={
              props.item.light && {
                itemId: props.item.id,
                light: props.item.light,
                placementKind: props.item.placement.kind,
              }
            }
            floorCovering={isFloorCovering({
              placementKind: props.item.placement.kind,
              sizeM: props.item.sizeM,
            })}
            onReady={handleReady}
          />
        </group>
        {entry?.kind === "appearing" &&
          (sidecars.kind === "ready" || sidecars.kind === "fade") && (
            <AppearingAsset
              projectId={props.projectId}
              item={props.item}
              assetId={props.assetId}
              sourceSizeM={props.item.sizeM}
              data={sidecars.kind === "ready" ? sidecars.data : undefined}
              reduced={reduced || sidecars.kind === "fade"}
              colors={props.colors}
              sceneLoadIn={{
                modelRef: groupRef,
                startedAtMs: entry.startedAtMs,
              }}
              onComplete={() => props.loadIn.complete(props.item.id)}
            />
          )}
      </Suspense>
    </AssetErrorBoundary>
  );
}
