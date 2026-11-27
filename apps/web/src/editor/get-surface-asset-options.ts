import type { SurfaceAsset } from "@planner/shared/src/protocol/surface-assets-result-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import type { MessageTranslator } from "../i18n/message-translator.ts";
import { getSurfaceAssetLabel } from "./get-surface-asset-label.ts";

export function getSurfaceAssetOptions(options: {
  assets: SurfaceAsset[];
  room: Room;
  t?: MessageTranslator;
  locale?: string;
}) {
  const entries = options.assets.map((asset) => ({
    asset,
    label: getSurfaceAssetLabel({
      asset,
      room: options.room,
      t: options.t,
      locale: options.locale,
    }),
  }));
  const groups = Object.groupBy(entries, (entry) => entry.label);
  const ordinals = Object.fromEntries(
    Object.values(groups).flatMap((group) =>
      (group ?? [])
        .toSorted(
          (a, b) =>
            Date.parse(a.asset.createdAt) - Date.parse(b.asset.createdAt) ||
            a.asset.assetId.localeCompare(b.asset.assetId),
        )
        .map(
          (entry, index) =>
            [entry.asset.assetId, index + 1] satisfies [string, number],
        ),
    ),
  );
  return entries.map((entry) => ({
    asset: entry.asset,
    label: `${entry.label}${(ordinals[entry.asset.assetId] ?? 1) > 1 ? ` · ${ordinals[entry.asset.assetId]}` : ""}`,
  }));
}
