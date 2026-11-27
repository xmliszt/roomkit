import type { SurfaceAsset } from "@planner/shared/src/protocol/surface-assets-result-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { createTranslator } from "../i18n/create-translator.ts";
import type { MessageTranslator } from "../i18n/message-translator.ts";
import { getSurfaceAssetSize } from "./get-surface-asset-size.ts";

const english = createTranslator({ locale: "en", catalog: {} });

export function getSurfaceAssetLabel(options: {
  asset: SurfaceAsset;
  room: Room;
  t?: MessageTranslator | undefined;
  locale?: string | undefined;
}) {
  const asset = options.asset;
  const size = getSurfaceAssetSize(asset);
  const wallIndex = options.room.walls.findIndex(
    (wall) => wall.id === asset.sourceSurfaceId,
  );
  const t = options.t ?? english;
  const surface =
    asset.sourceSurfaceId === "floor" || asset.sourceSurfaceId === "ceiling"
      ? asset.sourceSurfaceId
      : wallIndex >= 0
        ? "wall"
        : "unknown";
  const format = new Intl.NumberFormat(options.locale ?? "en", {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const width = format.format(size.u);
  const length = format.format(size.v);
  const dimensions =
    size.u === size.v
      ? t("editor.surface-asset.square", { width })
      : t("editor.surface-asset.rectangle", { width, length });
  const title = t(`editor.surface-asset.${surface}.${asset.kind}`);
  const withDimensions =
    wallIndex >= 0
      ? t("editor.surface-asset.from-wall", {
          title,
          wall: wallIndex + 1,
          dimensions,
        })
      : t("editor.surface-asset.with-dimensions", { title, dimensions });
  return withDimensions;
}
