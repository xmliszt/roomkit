import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import type { SurfaceMaterial } from "@planner/shared/src/scene/surface-material-schema.ts";
import { X } from "lucide-react";
import { motion } from "motion/react";
import { formatDecimal } from "../i18n/format-decimal.ts";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { getRoomBounds } from "../room/get-room-bounds.ts";
import { getWallSegments } from "../room/get-wall-segments.ts";
import { FloatingPopover } from "../ui/floating-popover.tsx";
import { panelEnter, panelExit } from "./interface-motion.ts";
import { LiveInput } from "./live-input.tsx";
import { NumberField } from "./number-field.tsx";
import { getSurfaceColor } from "./scene/get-surface-color.ts";
import { SurfaceControls } from "./surface-controls.tsx";
import type { useSurfaceAssets } from "./use-surface-assets.ts";

type RoomPanelProps = {
  projectId: string;
  library: ReturnType<typeof useSurfaceAssets>;
  room: Room;
  selectedSurfaceId: string | undefined;
  onSelectSurface: (surfaceId: string) => void;
  onSurfaceMaterial: (input: {
    surfaceId: string;
    color: string;
    material: SurfaceMaterial | null;
    isFinal: boolean;
  }) => void;
  onApplyWalls: () => void;
  onCancelPreview: () => void;
  onResize: (sizeM: {
    widthM: number;
    depthM: number;
    ceilingHeightM: number;
  }) => boolean;
  onSurfaceColor: (input: {
    surfaceId: string;
    color: string | null;
    isFinal: boolean;
  }) => void;
};

function isPositive(value: number) {
  return value > 0;
}

export function RoomPanel(props: RoomPanelProps) {
  const locale = useLocale();
  const t = useMessages();
  const bounds = getRoomBounds(props.room);
  const sizeM = {
    widthM: bounds.maxX - bounds.minX,
    depthM: bounds.maxZ - bounds.minZ,
    ceilingHeightM: props.room.ceilingHeightM,
  };
  const surfaces = [
    {
      surfaceId: "floor",
      label: t("editor.room-panel.floor"),
      lengthM: undefined,
    },
    {
      surfaceId: "ceiling",
      label: t("editor.room-panel.ceiling"),
      lengthM: undefined,
    },
    ...getWallSegments(props.room).flatMap((segment, index) =>
      segment.wall.kind === "open"
        ? []
        : [
            {
              surfaceId: segment.wall.id,
              label: t("editor.room-panel.wall-number", { number: index + 1 }),
              lengthM: segment.lengthM,
            },
          ],
    ),
  ];

  return (
    <FloatingPopover placement="below" width={280}>
      <motion.div
        data-editor-popover
        role="dialog"
        aria-label={t("editor.room-panel.room")}
        data-chrome
        initial={{ opacity: 0, scale: 0.95, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: panelEnter }}
        exit={{ opacity: 0, scale: 0.95, y: -4, transition: panelExit }}
        style={{ transformOrigin: "left top" }}
        className="panel relative w-full flex max-h-[calc(100dvh-80px)] flex-col gap-y-3 overflow-y-auto p-3"
      >
        <h2 className="type-panel-title">{t("editor.room-panel.room")}</h2>
        <div className="flex flex-col gap-y-1">
          <div className="type-label">{t("editor.room-panel.size")}</div>
          <div className="field-grid">
            <NumberField
              label={t("editor.room-panel.width")}
              value={sizeM.widthM}
              unit="m"
              decimals={2}
              isAllowed={isPositive}
              onCommit={(widthM) => props.onResize({ ...sizeM, widthM })}
            />
            <NumberField
              label={t("editor.room-panel.depth")}
              value={sizeM.depthM}
              unit="m"
              decimals={2}
              isAllowed={isPositive}
              onCommit={(depthM) => props.onResize({ ...sizeM, depthM })}
            />
            <NumberField
              label={t("editor.room-panel.ceiling")}
              value={sizeM.ceilingHeightM}
              unit="m"
              decimals={2}
              isAllowed={isPositive}
              onCommit={(ceilingHeightM) =>
                props.onResize({ ...sizeM, ceilingHeightM })
              }
            />
          </div>
        </div>
        <div className="flex flex-col gap-y-1">
          <div className="type-label">{t("editor.room-panel.surfaces")}</div>
          <div className="flex flex-col gap-y-0.5">
            {surfaces.map((surface) => {
              const stored = Object.hasOwn(
                props.room.surfaces,
                surface.surfaceId,
              )
                ? props.room.surfaces[surface.surfaceId]?.color
                : undefined;
              const shown =
                stored ??
                getSurfaceColor({
                  room: props.room,
                  surfaceId: surface.surfaceId,
                });
              return (
                <div
                  key={surface.surfaceId}
                  data-testid="surface-row"
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto_24px] items-center gap-x-2 whitespace-nowrap"
                >
                  <button
                    type="button"
                    aria-label={
                      surface.lengthM === undefined ? undefined : surface.label
                    }
                    aria-pressed={props.selectedSurfaceId === surface.surfaceId}
                    onClick={() => props.onSelectSurface(surface.surfaceId)}
                    className="h-7 min-w-0 truncate text-left text-ink aria-pressed:text-accent aria-pressed:underline"
                  >
                    {surface.label}
                    {surface.lengthM !== undefined && (
                      <span className="text-ink-dim">
                        {` · ${formatDecimal({ value: surface.lengthM, locale })} m`}
                      </span>
                    )}
                  </button>
                  <LiveInput
                    type="color"
                    aria-label={t("editor.room-panel.label-colour", {
                      label: surface.label,
                    })}
                    value={shown.toLowerCase()}
                    onLive={(color) =>
                      props.onSurfaceColor({
                        surfaceId: surface.surfaceId,
                        color,
                        isFinal: false,
                      })
                    }
                    onCommit={(color) =>
                      props.onSurfaceColor({
                        surfaceId: surface.surfaceId,
                        color,
                        isFinal: true,
                      })
                    }
                    className="size-[18px] cursor-pointer rounded-panel border border-line-strong p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[1px] [&::-webkit-color-swatch]:border-0"
                  />
                  <span
                    className={`tabular-nums ${stored === undefined ? "text-ink-dim" : ""}`}
                  >
                    {shown.toLowerCase()}
                  </span>
                  {stored === undefined ? (
                    <span />
                  ) : (
                    <button
                      type="button"
                      aria-label={t("editor.room-panel.reset-label-colour", {
                        label: surface.label,
                      })}
                      title={t("editor.room-panel.reset-to-default")}
                      onClick={() =>
                        props.onSurfaceColor({
                          surfaceId: surface.surfaceId,
                          color: null,
                          isFinal: true,
                        })
                      }
                      className="press grid size-6 place-items-center rounded-panel text-ink-dim hover:text-ink"
                    >
                      <X aria-hidden="true" size={12} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {props.library.error && (
          <output className="text-danger">
            {t("editor.room-panel.could-not-load-textures")}{" "}
            <button
              type="button"
              className="underline"
              onClick={props.library.retry}
            >
              {t("editor.room-panel.retry")}
            </button>
          </output>
        )}
        {props.selectedSurfaceId && (
          <SurfaceControls
            assets={props.library.assets}
            loading={props.library.isLoading}
            failed={props.library.error !== undefined}
            projectId={props.projectId}
            room={props.room}
            surfaceId={props.selectedSurfaceId}
            onChange={props.onSurfaceMaterial}
            onApplyWalls={props.onApplyWalls}
            onCancel={props.onCancelPreview}
          />
        )}
      </motion.div>
    </FloatingPopover>
  );
}
