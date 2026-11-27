"use client";

import type {
  Job,
  ReconstructionJob,
} from "@planner/shared/src/jobs/job-schema.ts";
import type { Project } from "@planner/shared/src/project/project-schema.ts";
import type { RenderView } from "@planner/shared/src/render/render-view-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Light } from "@planner/shared/src/scene/light-schema.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import { Canvas } from "@react-three/fiber";
import {
  type RefObject,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { getItemDimensionLines } from "../items/get-item-dimension-lines.ts";
import { getDimensionLine } from "../room/get-dimension-line.ts";
import { getWallSegments } from "../room/get-wall-segments.ts";
import type { BulbField } from "./bulb-field.ts";
import type { FrameTarget } from "./frame-target.ts";
import { useGenerationDisplays } from "./generation/use-generation-displays.ts";
import type { ItemSelection } from "./item-selection.ts";
import { useLoadIn } from "./load-in/use-load-in.ts";
import type { ObjectContextTarget } from "./object-context-target.ts";
import type { RoomReconstructionFrame } from "./reconstruction/create-room-reconstruction.ts";
import { RoomReconstruction } from "./reconstruction/room-reconstruction.tsx";
import type { CameraReport } from "./scene/camera-report.ts";
import { CameraRig } from "./scene/camera-rig.tsx";
import { ContextMenuCameraDismissal } from "./scene/context-menu-camera-dismissal.tsx";
import { getItemRenderLayout } from "./scene/get-item-render-layout.ts";
import { getSelectionSphere } from "./scene/get-selection-sphere.ts";
import { ItemsLayer } from "./scene/items-layer.tsx";
import { BulbMarker } from "./scene/lighting/bulb-marker.tsx";
import type { LightEmitterRegistry } from "./scene/lighting/light-emitter-registry.ts";
import { LightEmitterRegistryContext } from "./scene/lighting/light-emitter-registry-context.ts";
import { SceneLighting } from "./scene/lighting/scene-lighting.tsx";
import { SceneLitContext } from "./scene/lighting/scene-lit-context.ts";
import type { ShadeGlowRegistry } from "./scene/lighting/shade-glow.ts";
import { ShadeGlowRegistryContext } from "./scene/lighting/shade-glow-registry-context.ts";
import type { ShadowCasters } from "./scene/lighting/shadow-casters.ts";
import { ShadowCastersContext } from "./scene/lighting/shadow-casters-context.ts";
import { RenderBridge } from "./scene/render-bridge.tsx";
import { RoomShell } from "./scene/room-shell.tsx";
import { SnapshotBridge } from "./scene/snapshot-bridge.tsx";
import { useTokenColors } from "./scene/use-token-colors.ts";
import { SceneContextRecovery } from "./scene-context-recovery.tsx";
import type { Tool } from "./tool.ts";
import { useObjectContextGesture } from "./use-object-context-gesture.ts";

const noItems: Project["scene"]["items"] = [];

type SceneCanvasProps = {
  bulbField: BulbField | undefined;
  chromeShown: boolean;
  onCommitEmitter: (input: {
    itemId: string;
    emitter: Light["emitter"];
  }) => void;
  walking: boolean;
  lensMm: number;
  project: Project | undefined;
  labelsShown: boolean;
  gridShown: boolean;
  snapping: boolean;
  frameRequest: number;
  frameTarget: FrameTarget;
  getItem: (itemId: string) => Item | undefined;
  onPreviewPlacement: (
    input: { itemId: string; placement: Placement } | undefined,
  ) => void;
  tool: Tool;
  selectedItemId: string | undefined;
  selectedItemIds: readonly string[];
  selectedSurfaceId: string | undefined;
  onSelectSurface: (surfaceId: string) => void;
  unconfirmedItemIds: readonly string[];
  jobs: { [jobId: string]: Job };
  onCameraReport: (report: CameraReport) => void;
  onPointerMissed: () => void;
  onSelect: (selection: ItemSelection) => void;
  focusRef: RefObject<(() => void) | undefined>;
  contextMenuOpen: boolean;
  onOpenContextMenu: (target: ObjectContextTarget) => void;
  onCloseContextMenu: () => void;
  onCommitPlacement: (input: { itemId: string; placement: Placement }) => void;
  takeSnapshotRef: RefObject<(() => Promise<Blob>) | undefined>;
  readRenderViewRef: RefObject<(() => RenderView) | undefined>;
};

export function SceneCanvas(props: SceneCanvasProps) {
  const t = useMessages();
  const locale = useLocale();
  const loadIn = useLoadIn(props.project);
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  useImperativeHandle(
    props.focusRef,
    () => () => canvasElementRef.current?.focus(),
    [],
  );
  const [openingPreview, setOpeningPreview] = useState<{
    itemId: string;
    placement: Placement;
  }>();
  const beginContextGesture = useObjectContextGesture({
    onOpen: props.onOpenContextMenu,
  });
  const [emitters] = useState<LightEmitterRegistry>(() => ({}));
  const [shadowCasters] = useState<ShadowCasters>(() => ({ isStale: true }));
  const [shadeGlows] = useState<ShadeGlowRegistry>(() => ({}));
  const [isRestoring, setIsRestoring] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const remountCanvas = useCallback(
    () => setCanvasKey((current) => current + 1),
    [],
  );
  const sceneRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLElement | null)[]>([]);
  const itemLabelRefs = useRef<{ [key: string]: HTMLElement | null }>({});
  const [roomStage, setRoomStage] =
    useState<RoomReconstructionFrame["stage"]>("complete");
  const roomStageRef = useRef(roomStage);
  const reconstructionJob = Object.values(props.jobs)
    .filter(
      (job): job is ReconstructionJob =>
        job.kind === "reconstruction" && job.projectId === props.project?.id,
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .at(0);
  const handleRoomFrame = useCallback((frame: RoomReconstructionFrame) => {
    sceneRef.current?.setAttribute("data-room-stage", frame.stage);
    sceneRef.current?.setAttribute("data-room-height", String(frame.height));
    sceneRef.current?.setAttribute("data-room-opacity", String(frame.opacity));
    sceneRef.current?.setAttribute(
      "data-room-points-opacity",
      String(frame.pointsOpacity),
    );
    if (roomStageRef.current !== frame.stage) {
      roomStageRef.current = frame.stage;
      setRoomStage(frame.stage);
    }
  }, []);
  const room = props.project?.scene.room;
  const items = props.project?.scene.items;
  const [bulbPreview, setBulbPreview] = useState<{
    itemId: string;
    emitter: Light["emitter"];
  }>();
  const isLit = (items ?? noItems).some((item) => item.light?.on);
  const openingPreviewItems = useMemo(
    () =>
      openingPreview
        ? (items ?? noItems).map((item) =>
            openingPreview.itemId === item.id
              ? { ...item, placement: openingPreview.placement }
              : item,
          )
        : (items ?? noItems),
    [items, openingPreview],
  );
  const generation = useGenerationDisplays({
    items: items ?? noItems,
    jobs: props.jobs,
  });
  const itemsJson = useMemo(
    () => (items === undefined ? undefined : JSON.stringify(items)),
    [items],
  );
  const selectedItem = props.project?.scene.items.find(
    (item) => item.id === props.selectedItemId,
  );
  const bulbLayout =
    selectedItem && room
      ? getItemRenderLayout({
          item: selectedItem,
          segments: getWallSegments(room),
          ceilingHeightM: room.ceilingHeightM,
        })
      : undefined;
  const nudgeItem =
    selectedItem?.locked && props.selectedItemIds.length > 1
      ? (props.selectedItemIds
          .toReversed()
          .flatMap(
            (id) =>
              props.project?.scene.items.filter(
                (item) => item.id === id && !item.locked,
              ) ?? [],
          )
          .at(0) ?? selectedItem)
      : selectedItem;
  const itemLabels = (props.project?.scene.items ?? []).flatMap((item) => {
    const display = generation.displays.find(
      (entry) => entry.itemId === item.id,
    );
    const job =
      item.model.kind === "pending" &&
      Object.hasOwn(props.jobs, item.model.jobId)
        ? props.jobs[item.model.jobId]
        : undefined;
    const tag = [
      {
        key: `tag:${item.id}`,
        kind: "tag" as const,
        text: `${item.name} · ${t(`jobs.stage.${display?.kind ?? job?.stage ?? (item.model.kind === "asset" ? "ready" : "queued")}`)}`,
        failed: (display?.kind ?? job?.stage) === "failed",
        generating: display?.kind === "generating",
        generationStage: display?.kind,
      },
    ];
    const dimensions =
      item.id === props.selectedItemId
        ? getItemDimensionLines({
            placementKind: item.placement.kind,
            locale,
            sizeM: room
              ? (getItemRenderLayout({
                  item,
                  segments: getWallSegments(room),
                  ceilingHeightM: room.ceilingHeightM,
                })?.sizeM ?? item.sizeM)
              : item.sizeM,
          }).map((line, index) => ({
            key: `dimension:${item.id}:${index}`,
            kind: "dimension" as const,
            text: line.text,
            failed: false,
            generating: false,
          }))
        : [];
    return [...tag, ...dimensions];
  });
  const frameSphere =
    room === undefined
      ? undefined
      : getSelectionSphere({
          items: items ?? [],
          selectedIds: props.selectedItemIds,
          room,
        });
  const labels = useMemo(
    () =>
      room === undefined
        ? []
        : getWallSegments(room).map((segment) => ({
            wallId: segment.wall.id,
            text: getDimensionLine({ segment, locale }).text,
          })),
    [room, locale],
  );

  function handleCameraReport(report: CameraReport) {
    sceneRef.current?.setAttribute(
      "data-camera",
      JSON.stringify(report.camera),
    );
    props.onCameraReport(report);
  }

  function isNavigating() {
    return (
      sceneRef.current?.querySelector("canvas")?.dataset.viewportNavigation ===
      "true"
    );
  }

  function clearSelection(event?: MouseEvent) {
    if (event?.button === 2 || event?.type === "contextmenu") return;
    if (!isNavigating()) props.onPointerMissed();
  }

  function selectSurface(surfaceId: string) {
    if (!isNavigating()) props.onSelectSurface(surfaceId);
  }

  return (
    <div
      ref={sceneRef}
      data-testid="scene"
      data-navigation={props.walking ? "walk" : "orbit"}
      data-items={itemsJson}
      data-selected-items={JSON.stringify(props.selectedItemIds)}
      data-selected-surface={props.selectedSurfaceId}
      className="absolute z-canvas inset-0 bg-bg"
    >
      <Canvas
        key={canvasKey}
        onCreated={({ gl }) => {
          gl.domElement.tabIndex = 0;
          canvasElementRef.current = gl.domElement;
        }}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (
            !props.walking &&
            (event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10")) &&
            props.selectedItemId
          ) {
            event.preventDefault();
            event.stopPropagation();
            const rect =
              itemLabelRefs.current[
                `tag:${props.selectedItemId}`
              ]?.getBoundingClientRect();
            props.onOpenContextMenu({
              itemId: props.selectedItemId,
              xPx:
                rect && rect.width > 0
                  ? rect.left + rect.width / 2
                  : window.innerWidth / 2,
              yPx:
                rect && rect.height > 0 ? rect.bottom : window.innerHeight / 2,
            });
          }
        }}
        className="!absolute inset-0"
        frameloop="demand"
        flat
        gl={{ localClippingEnabled: true }}
        dpr={[1, 2]}
        camera={{ fov: 32, near: 0.1, far: 200 }}
        aria-label={
          props.walking
            ? t("editor.scene-canvas.3d-walk-view-wasd-or-arrows-move-q")
            : t("editor.scene-canvas.3d-view-of-the-room-drag-to-orbit")
        }
        onPointerMissed={clearSelection}
      >
        <SceneContextRecovery
          onRestoring={setIsRestoring}
          onRemount={remountCanvas}
        />
        {props.contextMenuOpen && (
          <ContextMenuCameraDismissal onMove={props.onCloseContextMenu} />
        )}
        <PaperBackground />
        <SnapshotBridge takeSnapshotRef={props.takeSnapshotRef} />
        {props.project && (
          <RenderBridge
            projectId={props.project.id}
            room={props.project.scene.room}
            walking={props.walking}
            readViewRef={props.readRenderViewRef}
          />
        )}
        <LightEmitterRegistryContext value={emitters}>
          <ShadeGlowRegistryContext value={shadeGlows}>
            <SceneLitContext value={isLit}>
              <ShadowCastersContext value={shadowCasters}>
                <SceneLighting items={items ?? noItems} />
                {props.project !== undefined && (
                  <group key={props.project.id}>
                    <RoomReconstruction
                      projectId={props.project.id}
                      room={props.project.scene.room}
                      job={reconstructionJob}
                      onFrame={handleRoomFrame}
                    >
                      <RoomShell
                        labelsShown={roomStage === "complete"}
                        walking={props.walking}
                        projectId={props.project.id}
                        selectedSurfaceId={props.selectedSurfaceId}
                        onSelectSurface={selectSurface}
                        onClearSelection={clearSelection}
                        room={props.project.scene.room}
                        items={openingPreviewItems}
                        labelRefs={labelRefs}
                        gridShown={props.gridShown}
                      />
                    </RoomReconstruction>
                    <ItemsLayer
                      loadIn={loadIn}
                      onOpeningPreview={setOpeningPreview}
                      projectId={props.project.id}
                      items={props.project.scene.items}
                      bulbPreview={bulbPreview}
                      room={props.project.scene.room}
                      labelsShown={props.labelsShown}
                      snapping={props.snapping}
                      tool={props.tool}
                      selectedItemId={props.selectedItemId}
                      selectedItemIds={props.selectedItemIds}
                      onPreview={props.onPreviewPlacement}
                      unconfirmedItemIds={props.unconfirmedItemIds}
                      generations={generation.displays}
                      onGenerationComplete={generation.complete}
                      labelRefs={itemLabelRefs}
                      onSelect={props.onSelect}
                      onContextPointerDown={beginContextGesture}
                      onCommit={props.onCommitPlacement}
                    />
                    {props.chromeShown &&
                      props.selectedItemIds.length === 1 &&
                      bulbLayout &&
                      selectedItem?.light && (
                        <BulbMarker
                          bulbField={props.bulbField}
                          key={selectedItem.id}
                          item={{
                            ...selectedItem,
                            sizeM: bulbLayout.sizeM,
                            light: selectedItem.light,
                          }}
                          onPreview={(emitter) =>
                            setBulbPreview(
                              emitter
                                ? { itemId: selectedItem.id, emitter }
                                : undefined,
                            )
                          }
                          onCommit={(emitter) =>
                            props.onCommitEmitter({
                              itemId: selectedItem.id,
                              emitter,
                            })
                          }
                        />
                      )}
                    <CameraRig
                      walking={props.walking}
                      lensMm={props.lensMm}
                      initialCamera={props.project.scene.camera}
                      room={props.project.scene.room}
                      reconstructionJobId={props.project.reconstruction?.jobId}
                      frameTarget={props.frameTarget}
                      selectedItem={nudgeItem}
                      snapping={props.snapping}
                      getItem={props.getItem}
                      onPreview={props.onPreviewPlacement}
                      onCommit={props.onCommitPlacement}
                      frameRequest={props.frameRequest}
                      frameSphere={frameSphere}
                      onMoveStart={props.onCloseContextMenu}
                      onReport={handleCameraReport}
                    />
                  </group>
                )}
              </ShadowCastersContext>
            </SceneLitContext>
          </ShadeGlowRegistryContext>
        </LightEmitterRegistryContext>
      </Canvas>
      <div className="pointer-events-none absolute z-label inset-0 overflow-hidden">
        {labels.map((label, index) => (
          <span
            key={label.wallId}
            ref={(node) => {
              labelRefs.current[index] = node;
            }}
            data-testid="wall-dimension"
            className="absolute top-0 left-0 hidden whitespace-nowrap bg-bg px-1 text-[10px] text-ink-dim tabular-nums leading-[14px]"
          >
            {label.text}
          </span>
        ))}
        {itemLabels.map((label) => (
          <span
            key={label.key}
            ref={(node) => {
              itemLabelRefs.current[label.key] = node;
            }}
            data-testid={label.kind === "tag" ? "item-tag" : "item-dimension"}
            data-generation-stage={
              label.kind === "tag" ? label.generationStage : undefined
            }
            className={(() => {
              switch (label.kind) {
                case "tag":
                  return `absolute top-0 left-0 hidden whitespace-nowrap border bg-panel px-1.5 text-[10px] leading-[14px] ${label.failed ? "border-danger text-danger" : label.generating ? "border-accent text-accent" : "border-line-strong text-ink-dim"}`;
                case "dimension":
                  return "absolute top-0 left-0 hidden whitespace-nowrap bg-bg px-1 text-[10px] text-accent tabular-nums leading-[14px]";
                default: {
                  const unreachable: never = label;
                  return unreachable;
                }
              }
            })()}
          >
            {label.text}
          </span>
        ))}
      </div>
      {isRestoring && (
        <output className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg text-ink-dim">
          {t("editor.scene-canvas.restoring-view")}
        </output>
      )}
    </div>
  );
}

function PaperBackground() {
  const tokens = useTokenColors();
  return <color attach="background" args={[tokens.bg]} />;
}
