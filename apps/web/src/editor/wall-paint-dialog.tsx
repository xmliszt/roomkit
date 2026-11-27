import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import type { SurfaceMaterial } from "@planner/shared/src/scene/surface-material-schema.ts";
import { useState } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { Modal } from "../ui/modal.tsx";
import { getSurfaceColor } from "./scene/get-surface-color.ts";
import { SurfaceControls } from "./surface-controls.tsx";

type Paint = Extract<SurfaceMaterial, { kind: "paint" }>;
type WallPaintDialogProps = {
  projectId: string;
  room: Room;
  onPreview: (paint: Paint) => void;
  onApply: (paint: Paint) => void;
  onClose: () => void;
};

export function WallPaintDialog(props: WallPaintDialogProps) {
  const t = useMessages();
  const wall = props.room.walls.find((entry) => entry.kind !== "open");
  const [paint, setPaint] = useState<Paint>(() => {
    const stored =
      wall && Object.hasOwn(props.room.surfaces, wall.id)
        ? props.room.surfaces[wall.id]?.material
        : undefined;
    return stored?.kind === "paint"
      ? stored
      : {
          kind: "paint",
          color: wall
            ? getSurfaceColor({ room: props.room, surfaceId: wall.id })
            : "#fcfbf9",
          finish: "matte",
        };
  });
  return (
    <Modal
      title={t("editor.wall-paint-dialog.paint-all-walls")}
      onClose={props.onClose}
    >
      <div className="flex flex-col gap-y-3 p-3">
        <p className="text-ink-dim">
          {t(
            "editor.wall-paint-dialog.choose-a-colour-and-finish-for-every-wall",
          )}
        </p>
        {wall && (
          <SurfaceControls
            assets={[]}
            projectId={props.projectId}
            loading={false}
            failed={false}
            room={{
              ...props.room,
              surfaces: {
                ...props.room.surfaces,
                [wall.id]: { color: paint.color, material: paint },
              },
            }}
            surfaceId={wall.id}
            paintOnly
            onCancel={props.onClose}
            onChange={(input) => {
              if (input.material?.kind !== "paint") return;
              setPaint(input.material);
              props.onPreview(input.material);
            }}
            onApplyWalls={() => props.onApply(paint)}
          />
        )}
      </div>
    </Modal>
  );
}
