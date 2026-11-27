"use client";

import type { CatalogEntry } from "@planner/shared/src/catalog/catalog-entry.ts";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import { applyCommand } from "@planner/shared/src/commands/apply-command.ts";
import type {
  Command,
  ItemPatch,
} from "@planner/shared/src/commands/command-schema.ts";
import { ProjectIdSchema } from "@planner/shared/src/project/project-id-schema.ts";
import type { ObjectsLibraryResult } from "@planner/shared/src/protocol/objects-library-result-schema.ts";
import type { RenderView } from "@planner/shared/src/render/render-view-schema.ts";
import type { Camera } from "@planner/shared/src/scene/camera-schema.ts";
import type { ColorAdjust } from "@planner/shared/src/scene/color-adjust-schema.ts";
import type { Light } from "@planner/shared/src/scene/light-schema.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { SurfaceMaterial } from "@planner/shared/src/scene/surface-material-schema.ts";
import { AnimatePresence, LayoutGroup, MotionConfig } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useStore } from "zustand";
import { AssetPreviewContext } from "../chat/asset-preview-context.ts";
import { createAssetPreviewRenderer } from "../chat/create-asset-preview-renderer.ts";
import { ItemHoverContext } from "../chat/item-hover-context.ts";
import { downloadBlob } from "../daemon-http/download-blob.ts";
import { exportProject } from "../daemon-http/export-project.ts";
import { importProject } from "../daemon-http/import-project.ts";
import { saveSnapshot } from "../daemon-http/save-snapshot.ts";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { getDuplicatePlacement } from "../items/get-duplicate-placement.ts";
import { useObjectsLibrary } from "../objects/use-objects-library.ts";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import { formatRoomSize } from "../room/format-room-size.ts";
import { getResizedWalls } from "../room/get-resized-walls.ts";
import { getRoomBounds } from "../room/get-room-bounds.ts";
import { containsFloatingTarget } from "../ui/contains-floating-target.ts";
import { BottomLeft } from "./bottom-left.tsx";
import { BottomRight } from "./bottom-right.tsx";
import type { BulbField } from "./bulb-field.ts";
import { ChatPanel } from "./chat-panel.tsx";
import type { ChatTab } from "./chat-tab.ts";
import { CommandPalette } from "./command-palette.tsx";
import { Composer } from "./composer.tsx";
import { DropFrame } from "./drop-frame.tsx";
import type { FrameTarget } from "./frame-target.ts";
import { getItemGenerationJob } from "./generation/get-item-generation-job.ts";
import { getCameraResend } from "./get-camera-resend.ts";
import { getGroupPlacementCommands } from "./get-group-placement-commands.ts";
import { getShortcutAction } from "./get-shortcut-action.ts";
import { Inspector } from "./inspector.tsx";
import { isEditorZoomEvent } from "./is-editor-zoom-event.ts";
import { isStoredColorAdjust } from "./is-stored-color-adjust.ts";
import { isTypingTarget } from "./is-typing-target.ts";
import { isViewportKeyTarget } from "./is-viewport-key-target.ts";
import type { ItemSelection } from "./item-selection.ts";
import { maxItemReferences } from "./max-item-references.ts";
import { ObjectContextMenu } from "./object-context-menu.tsx";
import type { ObjectContextTarget } from "./object-context-target.ts";
import { getLibraryPlacement } from "./objects/get-library-placement.ts";
import type { ObjectsPanelView } from "./objects/objects-panel-view.ts";
import { ProjectMenu } from "./project-menu.tsx";
import { RoomPanel } from "./room-panel.tsx";
import { SampleCoachmark } from "./sample-coachmark.tsx";
import { type SampleTourStep, sampleTourSteps } from "./sample-tour-steps.ts";
import type { CameraReport } from "./scene/camera-report.ts";
import { getSurfaceColor } from "./scene/get-surface-color.ts";
import { SceneCanvas } from "./scene-canvas.tsx";
import { selectItemIds } from "./select-item-ids.ts";
import { ShortcutSheet } from "./shortcut-sheet.tsx";
import { SnapshotPhotoModal } from "./snapshot-photo-modal.tsx";
import type { Tool } from "./tool.ts";
import { ToolRail } from "./tool-rail.tsx";
import { TopStrip } from "./top-strip.tsx";
import { useAttachedPhotos } from "./use-attached-photos.ts";
import { useChargingPortType } from "./use-charging-port-type.ts";
import { useFloorGrid } from "./use-floor-grid.ts";
import { useObjectLabels } from "./use-object-labels.ts";
import { useReconstructionResult } from "./use-reconstruction-result.ts";
import { useSceneHistory } from "./use-scene-history.ts";
import { useSnapping } from "./use-snapping.ts";
import { useSurfaceAssets } from "./use-surface-assets.ts";
import { useVoiceInput } from "./voice/use-voice-input.ts";
import { WallPaintDialog } from "./wall-paint-dialog.tsx";

type EditorShellProps = { projectId: string };

type Popover = "none" | "project" | "room";

type Status = {
  kind: "info" | "error";
  key: string;
  values?: { [name: string]: string | number };
};

const statusShownMs = 4000;

function isArchive(file: File) {
  return file.name.toLowerCase().endsWith(".iplan");
}

function describeError(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

function isSameCamera(options: { saved: Camera; shown: Camera }) {
  return JSON.stringify(options.saved) === JSON.stringify(options.shown);
}

export function EditorShell(props: EditorShellProps) {
  const previewRenderer =
    useRef<ReturnType<typeof createAssetPreviewRenderer>>(undefined);
  useEffect(() => {
    const renderer = createAssetPreviewRenderer();
    previewRenderer.current = renderer;
    return () => {
      renderer.dispose();
      previewRenderer.current = undefined;
    };
  }, []);
  return (
    <AssetPreviewContext value={previewRenderer}>
      <EditorShellBody {...props} />
    </AssetPreviewContext>
  );
}

const initialObjectsView: ObjectsPanelView = {
  filter: "all",
  search: "",
  expanded: undefined,
  removed: undefined,
};

function EditorShellBody(props: EditorShellProps) {
  const t = useMessages();
  const locale = useLocale();
  const session = usePlannerSession();
  const router = useRouter();
  const isValidId = ProjectIdSchema.safeParse(props.projectId).success;
  const surfaceLibrary = useSurfaceAssets(
    isValidId ? props.projectId : undefined,
  );
  const project = useStore(
    session.stores.projects,
    (state) => state.opened[props.projectId]?.project,
  );
  const tourButton = useRef<HTMLButtonElement>(null);
  const tourOpenedChat = useRef(false);
  const tourChatKey = `roomkit.sample-tour.chat.${props.projectId}`;
  const [tourStep, setTourStep] = useState<SampleTourStep["kind"]>();
  const isSample = project?.sample === true;
  const sampleLamp = isSample
    ? project.scene.items.find((item) => item.id === "lamp")
    : undefined;
  const sampleLampLight = sampleLamp?.light;
  const tourSteps = sampleLampLight
    ? sampleTourSteps
    : sampleTourSteps.filter((step) => step.kind !== "lamp");
  const tourIndex = tourSteps.findIndex(
    (step) =>
      step.kind ===
      (tourStep === "lamp" && !sampleLampLight ? "add" : tourStep),
  );
  const activeTourStep = tourSteps[tourIndex];
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [chatError, setChatError] = useState<string>();
  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const chatHistory = useStore(
    session.stores.activity,
    (state) => state.chats[props.projectId],
  );
  const connection = useStore(
    session.stores.snapshot,
    (state) => state.connection,
  );
  const designerCli = useStore(
    session.stores.snapshot,
    (state) => state.config?.roles.designer.cli,
  );
  const chatBusy =
    isSending ||
    connection !== "open" ||
    chatHistory?.isStale !== false ||
    (chatHistory?.messages.some(
      (message) =>
        message.status === "streaming" &&
        message.author.kind === "agent" &&
        message.author.role === "designer",
    ) ??
      false);
  useEffect(() => {
    if (isValidId) return session.watchChat(props.projectId);
  }, [session, isValidId, props.projectId]);
  const [popover, setPopover] = useState<Popover>("none");
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const [isSnapshotBusy, setIsSnapshotBusy] = useState(false);
  const surfacePopoverRef = useRef(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const focusCanvasRef = useRef<(() => void) | undefined>(undefined);
  const takeSnapshotRef = useRef<(() => Promise<Blob>) | undefined>(undefined);
  const readRenderViewRef = useRef<(() => RenderView) | undefined>(undefined);
  const [snapshotPhoto, setSnapshotPhoto] = useState<{
    png: Blob;
    view: RenderView;
  }>();
  const openError = useStore(
    session.stores.projects,
    (state) => state.openErrors[props.projectId],
  );
  const { labelsShown, setLabelsShown } = useObjectLabels();
  const { snapping, setSnapping } = useSnapping();
  const { gridShown, setGridShown } = useFloorGrid();
  const [isWalking, setIsWalking] = useState(false);
  const [lensMm, setLensMm] = useState(28);
  const [frameRequest, setFrameRequest] = useState(0);
  const [frameTarget, setFrameTarget] = useState<FrameTarget>("selection");
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [bulbField, setBulbField] = useState<BulbField>();
  const [isChromeHidden, setIsChromeHidden] = useState(false);
  const [isChatOpen, setChatOpen] = useState(false);
  const colorPreviewRef = useRef<{
    projectId: string;
    itemIds: string[];
    colorAdjust: ColorAdjust | null;
  }>(undefined);
  const commitColorPreviewRef = useRef<() => void>(undefined);
  const setIsChatOpen = useCallback((value: SetStateAction<boolean>) => {
    tourOpenedChat.current = false;
    commitColorPreviewRef.current?.();
    setChatOpen(value);
  }, []);
  const [chatTab, setChatTab] = useState<ChatTab>("chat");
  const [objectsViews, setObjectsViews] = useState<{
    [projectId: string]: ObjectsPanelView;
  }>({});
  const objectsView = objectsViews[props.projectId] ?? initialObjectsView;
  const openChat = useCallback(
    (tab: ChatTab) => {
      setChatTab(tab);
      setIsChatOpen(true);
    },
    [setIsChatOpen],
  );
  useEffect(() => {
    if (!isSample) return;
    try {
      if (sessionStorage.getItem(tourChatKey) === "active") {
        openChat("chat");
        tourOpenedChat.current = true;
        setTourStep("chat");
        return;
      }
    } catch {}
    try {
      if (localStorage.getItem("roomkit.sample-tour") === "seen") return;
    } catch {}
    setTourStep("orbit");
  }, [isSample, openChat, tourChatKey]);
  const showTourStep = useCallback(
    (step: SampleTourStep["kind"] | undefined) => {
      setTourStep(step);
      try {
        if (step === "chat") sessionStorage.setItem(tourChatKey, "active");
        else sessionStorage.removeItem(tourChatKey);
      } catch {}
    },
    [tourChatKey],
  );
  const closeTour = useCallback(
    (restoreFocus = true) => {
      showTourStep(undefined);
      if (tourOpenedChat.current) setIsChatOpen(false);
      if (restoreFocus) tourButton.current?.focus();
      try {
        localStorage.setItem("roomkit.sample-tour", "seen");
      } catch {}
    },
    [setIsChatOpen, showTourStep],
  );
  useEffect(() => {
    if (isWalking && tourStep !== undefined) closeTour(false);
  }, [isWalking, tourStep, closeTour]);

  function continueTour() {
    const next = tourSteps.at(tourIndex + 1);
    if (!next) {
      closeTour();
      return;
    }
    if ("tab" in next) {
      if (tourOpenedChat.current || !isChatOpen) {
        openChat(next.tab);
        tourOpenedChat.current = true;
      }
    } else if (tourOpenedChat.current) {
      setIsChatOpen(false);
    }
    showTourStep(next.kind);
  }
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const currentSelectedItemIds = useMemo(
    () =>
      selectedItemIds.filter((id) =>
        project?.scene.items.some((item) => item.id === id),
      ),
    [selectedItemIds, project?.scene.items],
  );
  const selectedItemId = currentSelectedItemIds.at(-1);
  function setSelectedItemId(itemId: string | undefined) {
    commitColorPreview();
    setSelectedItemIds(itemId ? [itemId] : []);
  }
  function selectItem(selection: ItemSelection) {
    commitColorPreview();
    setPreview(undefined);
    setPlacementPreview(undefined);
    setSelectedSurfaceId(undefined);
    setSelectedItemIds(
      selectItemIds({ current: currentSelectedItemIds, selection }),
    );
    setIsAddOpen(false);
  }
  const [contextTarget, setContextTarget] = useState<ObjectContextTarget>();
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string>();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const objectsLibrary = useObjectsLibrary({ projectId: props.projectId });
  const [isPaintingWalls, setIsPaintingWalls] = useState(false);
  const [wallPaintPreview, setWallPaintPreview] =
    useState<Extract<SurfaceMaterial, { kind: "paint" }>>();
  const [placementPreview, setPlacementPreview] = useState<{
    itemId: string;
    placement: Placement;
  }>();
  const [preview, setPreview] = useState<Command | undefined>(undefined);
  const shownProject = useMemo(() => {
    if (
      project === undefined ||
      (preview === undefined &&
        wallPaintPreview === undefined &&
        placementPreview === undefined) ||
      (preview?.type === "item.update" && preview.itemId !== selectedItemId)
    ) {
      return project;
    }
    const commands: Command[] = placementPreview
      ? getGroupPlacementCommands({
          ...placementPreview,
          items: project.scene.items,
          selectedIds: currentSelectedItemIds,
          room: project.scene.room,
        })
      : wallPaintPreview
        ? project.scene.room.walls
            .filter((wall) => wall.kind !== "open")
            .map((wall) => ({
              type: "surface.update",
              surfaceId: wall.id,
              color: wallPaintPreview.color,
              material: wallPaintPreview,
            }))
        : preview
          ? preview.type === "item.update" &&
            preview.patch.colorAdjust !== undefined
            ? currentSelectedItemIds.map((itemId) => ({ ...preview, itemId }))
            : [preview]
          : [];
    const scene = commands.reduce((current, command) => {
      const result = applyCommand({ scene: current, command });
      return result.kind === "applied" ? result.scene : current;
    }, project.scene);
    return { ...project, scene };
  }, [
    project,
    preview,
    placementPreview,
    wallPaintPreview,
    selectedItemId,
    currentSelectedItemIds,
  ]);
  const [unconfirmedItemIds, setUnconfirmedItemIds] = useState<string[]>([]);
  const jobs = useStore(session.stores.jobs, (state) => state.jobs);
  const history = useSceneHistory({ session, projectId: props.projectId });
  const chargingPortType = useChargingPortType(props.projectId);
  const selectedItem = project?.scene.items.find(
    (item) => item.id === selectedItemId,
  );
  const selectedItems = currentSelectedItemIds.flatMap(
    (id) => project?.scene.items.filter((item) => item.id === id) ?? [],
  );
  if (contextTarget && !selectedItem) setContextTarget(undefined);
  const [hoveredChatItemId, setHoveredChatItemId] = useState<string>();
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const currentReferenceIds = project
    ? referenceIds.filter((id) =>
        project.scene.items.some((item) => item.id === id),
      )
    : referenceIds;
  if (currentReferenceIds.length !== referenceIds.length)
    setReferenceIds(currentReferenceIds);
  const referencedItems = currentReferenceIds.flatMap(
    (id) => project?.scene.items.filter((item) => item.id === id) ?? [],
  );
  function addItemReference(itemId: string) {
    setReferenceIds((current) =>
      [
        ...new Set([
          ...current.filter((id) =>
            project?.scene.items.some((item) => item.id === id),
          ),
          itemId,
        ]),
      ].slice(0, maxItemReferences),
    );
  }
  function removeItemReference(itemId: string) {
    setReferenceIds((current) => current.filter((id) => id !== itemId));
  }
  const selectedJob = getItemGenerationJob({
    projectId: props.projectId,
    item: selectedItem,
    jobs: Object.values(jobs),
    messages: chatHistory?.messages ?? [],
  });
  const shownSelectedItem = shownProject?.scene.items.find(
    (item) => item.id === selectedItemId,
  );
  const hasSelection = selectedItem !== undefined;
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const promptRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceInput({
    inputRef: promptRef,
    isPaused: isSending,
  });
  const voiceRef = useRef(voice);
  useEffect(() => {
    if (!isChatOpen) voiceRef.current.cancel();
  }, [isChatOpen]);
  const attached = useAttachedPhotos();
  const addFilesRef = useRef(attached.addFiles);
  const importArchiveRef = useRef(importArchive);
  const movedCameraRef = useRef<Camera | undefined>(undefined);
  const shownCameraRef = useRef<Camera | undefined>(undefined);
  const itemActionsRef = useRef({
    hasSelection,
    selectAll,
    clearSelection,
    deleteSelected,
    duplicateSelected,
    undo,
    redo,
    snapshot: takeSnapshot,
    popover,
    closePopover,
  });

  useEffect(() => {
    commitColorPreviewRef.current = commitColorPreview;
    addFilesRef.current = attached.addFiles;
    voiceRef.current = voice;
    importArchiveRef.current = importArchive;
    itemActionsRef.current = {
      hasSelection,
      selectAll,
      clearSelection,
      deleteSelected,
      duplicateSelected,
      undo,
      redo,
      snapshot: takeSnapshot,
      popover,
      closePopover,
    };
  });

  useEffect(() => {
    if (status?.kind !== "info") return;
    const timer = setTimeout(() => setStatus(undefined), statusShownMs);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (popover === "none") return;
    function handlePointerDown(event: PointerEvent) {
      if (
        containsFloatingTarget({
          root: popoverRef.current,
          target: event.target,
        })
      ) {
        return;
      }
      surfacePopoverRef.current = false;
      setPopover("none");
      setPreview(undefined);
    }
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [popover]);

  useEffect(() => {
    colorPreviewRef.current = undefined;
    setSelectedItemIds([]);
    setSelectedSurfaceId(undefined);
    setPlacementPreview(undefined);
    setWallPaintPreview(undefined);
    setIsPaintingWalls(false);
    setUnconfirmedItemIds([]);
    setPreview(undefined);
    setPopover("none");
    setStatus(undefined);
    return session.stores.projects.subscribe((state) => {
      const items = state.opened[props.projectId]?.project.scene.items;
      const pending = colorPreviewRef.current;
      if (
        items &&
        pending?.projectId === props.projectId &&
        pending.itemIds.some((id) => !items.some((item) => item.id === id))
      ) {
        colorPreviewRef.current = undefined;
        setPreview(undefined);
      }
      if (items)
        setSelectedItemIds((current) => {
          const remaining = current.filter((id) =>
            items.some((item) => item.id === id),
          );
          return remaining.length === current.length ? current : remaining;
        });
      if ((state.ownRequestIds[props.projectId] ?? []).length === 0) {
        setUnconfirmedItemIds((current) =>
          current.length === 0 ? current : [],
        );
      }
    });
  }, [session, props.projectId]);

  useEffect(() => {
    if (!isValidId) {
      return;
    }
    session.stores.projects.setState((state) => {
      const entry = state.opened[props.projectId];
      return entry
        ? {
            opened: {
              ...state.opened,
              [props.projectId]: { ...entry, isStale: true },
            },
          }
        : state;
    });
    return session.watchProject(props.projectId);
  }, [session, isValidId, props.projectId]);

  const openRoomForReconstruction = useCallback(() => {
    surfacePopoverRef.current = false;
    setPopover("room");
  }, []);
  useReconstructionResult({
    projectId: props.projectId,
    onOpenRoom: openRoomForReconstruction,
  });

  useEffect(() => {
    movedCameraRef.current = undefined;
    return session.stores.projects.subscribe((state, previous) => {
      const resend = getCameraResend({
        previous: previous.opened[props.projectId],
        current: state.opened[props.projectId],
        moved: movedCameraRef.current,
        pendingRequestCount: (state.ownRequestIds[props.projectId] ?? [])
          .length,
      });
      switch (resend.kind) {
        case "keep":
          return;
        case "forget":
          movedCameraRef.current = undefined;
          return;
        case "resend":
          session.applySceneCommand({
            projectId: props.projectId,
            command: { type: "camera.set", camera: resend.camera },
          });
          return;
        default: {
          const unreachable: never = resend;
          return unreachable;
        }
      }
    });
  }, [session, props.projectId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsChromeHidden(false);
        setIsPaletteOpen((current) => !current);
        return;
      }
      if (event.repeat) {
        return;
      }
      const shortcut = getShortcutAction({
        key: event.key,
        code: event.code,
        isTyping:
          isTypingTarget(event.target) &&
          !(
            event.key === "Escape" &&
            event.target instanceof HTMLElement &&
            event.target.closest('[data-testid="light-controls"]')
          ),
        isWalking,
        isCommandHeld: event.metaKey || event.ctrlKey,
        isShiftHeld: event.shiftKey,
        isAltHeld: event.altKey,
      });
      const isExitBlocked =
        shortcut?.kind === "exit-walk" &&
        (itemActionsRef.current.popover !== "none" ||
          itemActionsRef.current.hasSelection ||
          !isViewportKeyTarget(event.target));
      const action: ReturnType<typeof getShortcutAction> = isExitBlocked
        ? { kind: "clear-selection" }
        : shortcut;
      if (
        action === undefined ||
        (["frame", "enter-walk", "start-voice"].includes(action.kind) &&
          !isViewportKeyTarget(event.target)) ||
        (action.kind === "start-voice" &&
          document.querySelector("dialog[open]") !== null)
      ) {
        return;
      }
      event.preventDefault();
      switch (action.kind) {
        case "enter-walk":
          setContextTarget(undefined);
          setIsWalking(true);
          return;
        case "exit-walk":
          setIsWalking(false);
          return;
        case "toggle-chrome":
          setIsChromeHidden((current) => !current);
          return;
        case "focus-prompt":
          flushSync(() => setIsChromeHidden(false));
          promptRef.current?.focus();
          return;
        case "set-tool":
          setTool(action.tool);
          return;
        case "toggle-labels":
          setLabelsShown((current) => !current);
          return;
        case "toggle-grid":
          setGridShown((current) => !(current ?? true));
          return;
        case "toggle-snap":
          setSnapping((current) => !(current ?? true));
          return;
        case "shortcuts":
          setIsShortcutsOpen((current) => !current);
          return;
        case "toggle-chat":
          setIsChromeHidden(false);
          setIsChatOpen((current) => !current);
          return;
        case "objects":
          setIsChromeHidden(false);
          openChat("objects");
          return;
        case "start-voice":
          flushSync(() => {
            setIsChromeHidden(false);
            openChat("chat");
          });
          voiceRef.current.start();
          return;
        case "frame":
          setFrameTarget(action.target);
          setFrameRequest((current) => current + 1);
          return;
        case "select-all":
          itemActionsRef.current.selectAll();
          return;
        case "clear-selection":
          if (itemActionsRef.current.popover !== "none") {
            const isSurfacePopover = surfacePopoverRef.current;
            itemActionsRef.current.closePopover();
            if (!isSurfacePopover) return;
          }
          itemActionsRef.current.clearSelection();
          return;
        case "snapshot":
          void itemActionsRef.current.snapshot();
          return;
        case "delete":
          itemActionsRef.current.deleteSelected();
          return;
        case "duplicate":
          itemActionsRef.current.duplicateSelected();
          return;
        case "undo":
          itemActionsRef.current.undo();
          return;
        case "redo":
          itemActionsRef.current.redo();
          return;
        default: {
          const unreachable: never = action;
          return unreachable;
        }
      }
    }
    function preventPageZoom(event: KeyboardEvent) {
      if (!isEditorZoomEvent(event)) return;
      event.preventDefault();
      if (
        !isWalking &&
        event.key === "0" &&
        !event.repeat &&
        isViewportKeyTarget(event.target)
      ) {
        setFrameTarget("room");
        setFrameRequest((current) => current + 1);
      }
    }
    window.addEventListener("keydown", preventPageZoom, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", preventPageZoom, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    setLabelsShown,
    setSnapping,
    setGridShown,
    isWalking,
    openChat,
    setIsChatOpen,
  ]);

  useEffect(() => {
    let dragDepth = 0;
    function hasFiles(event: DragEvent) {
      return event.dataTransfer?.types.includes("Files") ?? false;
    }
    function handleDragEnter(event: DragEvent) {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      dragDepth += 1;
      setIsDraggingFiles(true);
    }
    function handleDragLeave(event: DragEvent) {
      if (!hasFiles(event)) {
        return;
      }
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setIsDraggingFiles(false);
      }
    }
    function handleDragOver(event: DragEvent) {
      if (hasFiles(event)) {
        event.preventDefault();
      }
    }
    function handleDrop(event: DragEvent) {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      dragDepth = 0;
      setIsDraggingFiles(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      const archive = files.find(isArchive);
      if (archive !== undefined) {
        void importArchiveRef.current(archive);
        return;
      }
      addFilesRef.current(files);
      promptRef.current?.focus();
    }
    function handlePaste(event: ClipboardEvent) {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length > 0) {
        addFilesRef.current(files);
        promptRef.current?.focus();
      }
    }
    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("paste", handlePaste);
    };
  }, []);

  function closePopover() {
    surfacePopoverRef.current = false;
    setPopover("none");
    setPreview(undefined);
  }

  function togglePopover(next: Exclude<Popover, "none">) {
    surfacePopoverRef.current = false;
    setPreview(undefined);
    setPopover((current) => (current === next ? "none" : next));
  }

  function updateSelected(patch: ItemPatch) {
    if (selectedItem === undefined) return false;
    if (patch.colorAdjust === undefined) commitColorPreview();
    if (
      Object.keys(patch).length === 1 &&
      patch.colorAdjust !== undefined &&
      selectedItems.every((item) =>
        isStoredColorAdjust({
          shown: patch.colorAdjust ?? null,
          stored: item.colorAdjust,
        }),
      )
    )
      return false;
    const applied = history.applyGroup(
      selectedItems.map((item) => ({
        type: "item.update",
        itemId: item.id,
        patch,
      })),
    );
    const model = patch.model;
    const entry =
      model?.kind === "asset"
        ? CHARGING_PORT_TYPES.find((type) => type.assetId === model.assetId)
        : undefined;
    if (applied && entry !== undefined) {
      setUnconfirmedItemIds((current) => [...current, selectedItem.id]);
      chargingPortType.remember(entry);
    }
    return applied;
  }

  function commitColorPreview() {
    const pending = colorPreviewRef.current;
    colorPreviewRef.current = undefined;
    if (!pending || pending.projectId !== props.projectId) return;
    setPreview(undefined);
    const stored =
      session.stores.projects.getState().opened[props.projectId]?.project.scene
        .items ?? [];
    const items = stored.filter((item) => pending.itemIds.includes(item.id));
    if (
      items.every((item) =>
        isStoredColorAdjust({
          shown: pending.colorAdjust,
          stored: item.colorAdjust,
        }),
      )
    )
      return;
    history.applyGroup(
      items.map((item) => ({
        type: "item.update",
        itemId: item.id,
        patch: { colorAdjust: pending.colorAdjust },
      })),
    );
  }

  function previewSelectedColor(colorAdjust: ColorAdjust | null | undefined) {
    const isStored =
      colorAdjust === undefined ||
      selectedItems.every((item) =>
        isStoredColorAdjust({ shown: colorAdjust, stored: item.colorAdjust }),
      );
    if (!selectedItem || isStored || colorAdjust === undefined) {
      colorPreviewRef.current = undefined;
      setPreview(undefined);
      return;
    }
    colorPreviewRef.current = {
      projectId: props.projectId,
      itemIds: currentSelectedItemIds,
      colorAdjust,
    };
    setPreview({
      type: "item.update",
      itemId: selectedItem.id,
      patch: { colorAdjust },
    });
  }

  function resizeRoom(sizeM: {
    widthM: number;
    depthM: number;
    ceilingHeightM: number;
  }) {
    if (project === undefined) return false;
    const room = project.scene.room;
    const bounds = getRoomBounds(room);
    const isSameFootprint =
      sizeM.widthM === bounds.maxX - bounds.minX &&
      sizeM.depthM === bounds.maxZ - bounds.minZ;
    return applyItemCommand({
      type: "room.update",
      walls: isSameFootprint
        ? undefined
        : getResizedWalls({
            room,
            widthM: sizeM.widthM,
            depthM: sizeM.depthM,
          }),
      ceilingHeightM:
        sizeM.ceilingHeightM === room.ceilingHeightM
          ? undefined
          : sizeM.ceilingHeightM,
    });
  }

  function setSurfaceColor(input: {
    surfaceId: string;
    color: string | null;
    isFinal: boolean;
  }) {
    const material = project?.scene.room.surfaces[input.surfaceId]?.material;
    const command: Command = {
      type: "surface.update",
      surfaceId: input.surfaceId,
      color: input.color,
      ...(input.color && material?.kind === "paint"
        ? { material: { ...material, color: input.color } }
        : input.color &&
            (material?.kind === "tiles" || material?.kind === "planks")
          ? { material: { ...material, baseColor: input.color } }
          : {}),
    };
    if (!input.isFinal) {
      const isStored =
        project !== undefined &&
        input.color?.toLowerCase() ===
          getSurfaceColor({
            room: project.scene.room,
            surfaceId: input.surfaceId,
          }).toLowerCase();
      setPreview(isStored ? undefined : command);
      return;
    }
    setPreview(undefined);
    applyItemCommand(command);
  }

  function selectSurface(surfaceId: string) {
    commitColorPreview();
    setPlacementPreview(undefined);
    surfacePopoverRef.current = true;
    setPreview(undefined);
    setSelectedItemId(undefined);
    setSelectedSurfaceId(surfaceId);
    setPopover("room");
  }

  function setSurfaceMaterial(input: {
    surfaceId: string;
    color: string;
    material: SurfaceMaterial | null;
    isFinal: boolean;
  }) {
    const command: Command = {
      type: "surface.update",
      surfaceId: input.surfaceId,
      color: input.color,
      material: input.material,
    };
    if (!input.isFinal) {
      setPreview(command);
      return;
    }
    setPreview(undefined);
    const stored = project?.scene.room.surfaces[input.surfaceId];
    if (
      stored?.color === input.color &&
      JSON.stringify(stored.material ?? null) === JSON.stringify(input.material)
    )
      return;
    history.apply(command);
  }

  function applyToWalls() {
    if (!project || !selectedSurfaceId) return;
    const surface = project.scene.room.surfaces[selectedSurfaceId];
    const color = getSurfaceColor({
      room: project.scene.room,
      surfaceId: selectedSurfaceId,
    });
    history.applyGroup(
      project.scene.room.walls
        .filter((wall) => wall.kind !== "open" && wall.id !== selectedSurfaceId)
        .map((wall) => ({
          type: "surface.update",
          surfaceId: wall.id,
          color,
          material: surface?.material ?? null,
        })),
    );
  }

  async function renameProject(name: string) {
    try {
      const ack = await session.command({
        type: "project.rename",
        projectId: props.projectId,
        name,
      });
      return ack.ok ? undefined : ack.error;
    } catch (caught) {
      return describeError(caught);
    }
  }

  async function exportCurrent() {
    setPopover("none");
    setStatus({ kind: "info", key: "editor.editor-shell.exporting" });
    try {
      const exported = await exportProject({ projectId: props.projectId });
      downloadBlob({ blob: exported.archive, fileName: exported.fileName });
      setStatus({
        kind: "info",
        key: "editor.editor-shell.exported-filename",
        values: {
          fileName: exported.fileName,
        },
      });
    } catch (caught) {
      setStatus({
        kind: "error",
        key: "editor.editor-shell.export-failed",
        values: {
          detail: describeError(caught),
        },
      });
    }
  }

  async function importArchive(archive: File) {
    setPopover("none");
    setStatus({
      kind: "info",
      key: "editor.editor-shell.importing-name",
      values: { name: archive.name },
    });
    try {
      const imported = await importProject(archive);
      setStatus(undefined);
      router.push(`/projects/${imported.id}`);
    } catch (caught) {
      setStatus({
        kind: "error",
        key: "editor.editor-shell.import-failed",
        values: {
          detail: describeError(caught),
        },
      });
    }
  }

  async function takeSnapshot() {
    const take = takeSnapshotRef.current;
    const view = readRenderViewRef.current?.();
    if (!take || !project || !view || isSnapshotBusy) return;
    setIsSnapshotBusy(true);
    try {
      const png = await take();
      const fileName = await saveSnapshot({ projectId: project.id, png });
      downloadBlob({ blob: png, fileName });
      setSnapshotPhoto({ png, view });
      setStatus({
        kind: "info",
        key: "editor.editor-shell.snapshot-saved-filename",
        values: {
          fileName: fileName,
        },
      });
    } catch (caught) {
      setStatus({
        kind: "error",
        key: "editor.editor-shell.snapshot-failed",
        values: {
          detail: describeError(caught),
        },
      });
    } finally {
      setIsSnapshotBusy(false);
    }
  }

  function cancelPreview() {
    colorPreviewRef.current = undefined;
    setPlacementPreview(undefined);
    setPreview(undefined);
    setWallPaintPreview(undefined);
  }

  function undo() {
    const isColorPreview = colorPreviewRef.current !== undefined;
    cancelPreview();
    if (!isColorPreview) history.undo();
  }

  function redo() {
    cancelPreview();
    history.redo();
  }

  function closeContextMenu() {
    setContextTarget(undefined);
  }

  function focusCanvas() {
    focusCanvasRef.current?.();
  }

  function openChatForMessage() {
    const shouldTourControlChat =
      activeTourStep?.kind === "chat" &&
      (tourOpenedChat.current || !isChatOpen);
    openChat("chat");
    if (shouldTourControlChat) tourOpenedChat.current = true;
  }

  function focusTourMessage() {
    flushSync(openChatForMessage);
    promptRef.current?.focus();
  }

  function openContextMenu(target: ObjectContextTarget) {
    commitColorPreview();
    setSelectedSurfaceId(undefined);
    setSelectedItemIds(
      currentSelectedItemIds.includes(target.itemId)
        ? [
            ...currentSelectedItemIds.filter((id) => id !== target.itemId),
            target.itemId,
          ]
        : [target.itemId],
    );
    setIsAddOpen(false);
    setContextTarget(target);
  }

  function sendSelectedToChat() {
    if (!selectedItem) return;
    if (
      new Set([...currentReferenceIds, ...currentSelectedItemIds]).size >
      maxItemReferences
    ) {
      setStatus({
        kind: "error",
        key: "editor.editor-shell.send-to-chat-supports-up-to-maxitemreferences-objects",
        values: { maxItemReferences: maxItemReferences },
      });
      return;
    }
    flushSync(() => {
      setIsChromeHidden(false);
      setReferenceIds([
        ...new Set([...currentReferenceIds, ...currentSelectedItemIds]),
      ]);
    });
    promptRef.current?.focus();
  }

  function selectAll() {
    commitColorPreview();
    setPlacementPreview(undefined);
    setIsAddOpen(false);
    setSelectedSurfaceId(undefined);
    setPreview(undefined);
    setSelectedItemIds(project?.scene.items.map((item) => item.id) ?? []);
  }

  function clearSelection() {
    commitColorPreview();
    setPlacementPreview(undefined);
    closeContextMenu();
    setSelectedSurfaceId(undefined);
    setPreview(undefined);
    setSelectedItemId(undefined);
    setIsAddOpen(false);
  }

  function applyItemCommand(command: Command) {
    return history.apply(command);
  }

  function toggleSampleLamp() {
    if (!sampleLamp || !sampleLampLight) return;
    applyItemCommand({
      type: "item.update",
      itemId: sampleLamp.id,
      patch: { light: { ...sampleLampLight, on: !sampleLampLight.on } },
    });
  }

  function deleteSelected() {
    commitColorPreview();
    if (
      history.applyGroup(
        selectedItems.map((item) => ({ type: "item.remove", itemId: item.id })),
      )
    )
      clearSelection();
  }

  function duplicateSelected() {
    duplicateItem({});
  }

  function duplicateMirroredSelected() {
    duplicateItem({ mirror: true });
  }

  function setSelectedLightsOn(on: boolean) {
    commitColorPreview();
    history.applyGroup(
      selectedItems.flatMap((item) =>
        item.light === undefined || item.light.on === on
          ? []
          : [
              {
                type: "item.update",
                itemId: item.id,
                patch: { light: { ...item.light, on } },
              } satisfies Command,
            ],
      ),
    );
  }

  function mirrorSelected() {
    commitColorPreview();
    history.applyGroup(
      selectedItems.map((item) => ({
        type: "item.update",
        itemId: item.id,
        patch: { mirrored: !item.mirrored },
      })),
    );
  }

  function duplicateItem(options: { mirror?: boolean }) {
    commitColorPreview();
    if (!project || selectedItems.some((item) => item.model.kind === "pending"))
      return;
    const commands = selectedItems.map(
      (item): Extract<Command, { type: "item.duplicate" }> => ({
        type: "item.duplicate",
        itemId: item.id,
        newItemId: crypto.randomUUID(),
        ...(options.mirror ? { mirrored: !item.mirrored } : {}),
        placement: getDuplicatePlacement({
          placement: item.placement,
          sizeM: item.sizeM,
          room: project.scene.room,
        }),
      }),
    );
    if (history.applyGroup(commands))
      setSelectedItemIds(commands.map((command) => command.newItemId));
  }

  function commitPlacement(input: { itemId: string; placement: Placement }) {
    setPlacementPreview(undefined);
    if (!project) return;
    history.applyGroup(
      getGroupPlacementCommands({
        ...input,
        items: project.scene.items,
        selectedIds: currentSelectedItemIds,
        room: project.scene.room,
      }),
    );
  }

  function addFromPhoto() {
    setIsAddOpen(false);
    document.querySelector<HTMLButtonElement>("[data-attach-photo]")?.click();
  }

  function addFromPrompt() {
    flushSync(() => {
      setIsAddOpen(false);
      setIsChromeHidden(false);
    });
    promptRef.current?.focus();
  }

  function addVariantOfSelection() {
    setIsAddOpen(false);
    openChat("selected");
  }

  function addChargingPort(chargingPort: CatalogEntry) {
    setIsAddOpen(false);
    if (project === undefined) {
      return;
    }
    const placement = getLibraryPlacement({
      model: chargingPort,
      camera: shownCameraRef.current ?? project.scene.camera,
      room: project.scene.room,
    });
    if (placement === undefined) {
      setStatus({
        kind: "error",
        key: "editor.editor-shell.this-room-has-no-wall-for-the-model",
      });
      return;
    }
    const itemId = crypto.randomUUID();
    if (
      applyItemCommand({
        type: "item.add",
        item: {
          id: itemId,
          name: chargingPort.name,
          model: { kind: "asset", assetId: chargingPort.assetId },
          placement,
          sizeM: chargingPort.sizeM,
          locked: false,
        },
      })
    ) {
      setUnconfirmedItemIds((current) => [...current, itemId]);
      setSelectedItemId(itemId);
    }
  }

  function placeLibraryObject(object: ObjectsLibraryResult["objects"][number]) {
    if (!project) return;
    const placement = getLibraryPlacement({
      model: {
        assetId: object.assetId,
        mount: object.mount,
        sizeM: object.nativeSizeM,
      },
      camera: shownCameraRef.current ?? project.scene.camera,
      room: project.scene.room,
    });
    if (!placement) {
      setStatus({
        kind: "error",
        key: "editor.editor-shell.this-room-has-no-wall-for-the-model",
      });
      return;
    }
    const id = crypto.randomUUID();
    if (
      applyItemCommand({
        type: "item.add",
        item: {
          id,
          name: object.name,
          model: { kind: "asset", assetId: object.assetId },
          sizeM: object.nativeSizeM,
          placement,
          locked: false,
        },
      })
    ) {
      setSelectedSurfaceId(undefined);
      setSelectedItemId(id);
      setTool("select");
      if (object.builtIn) setUnconfirmedItemIds((current) => [...current, id]);
    }
  }

  function handleCameraReport(report: CameraReport) {
    shownCameraRef.current = report.camera;
    if (report.kind !== "moved") {
      return;
    }
    const saved =
      session.stores.projects.getState().opened[props.projectId]?.project.scene
        .camera;
    if (saved !== undefined && isSameCamera({ saved, shown: report.camera })) {
      movedCameraRef.current = undefined;
      return;
    }
    movedCameraRef.current = report.camera;
    if (saved === undefined) {
      return;
    }
    session.applySceneCommand({
      projectId: props.projectId,
      command: { type: "camera.set", camera: report.camera },
    });
  }

  async function sendChat(
    input:
      | string
      | { text: string; photos: typeof attached.photos; itemIds: string[] },
  ) {
    const text = typeof input === "string" ? input : input.text;
    const photos = typeof input === "string" ? [] : input.photos;
    const itemIds = typeof input === "string" ? [] : input.itemIds;
    if ((!text.trim() && photos.length === 0) || chatBusy || sendingRef.current)
      return false;
    sendingRef.current = true;
    setIsSending(true);
    setChatError(undefined);
    openChatForMessage();
    try {
      const { uploadChatPhotos } = await import(
        "../chat/upload-chat-photos.ts"
      );
      const photoIds = await uploadChatPhotos({
        projectId: props.projectId,
        files: photos.map((photo) => photo.file),
      });
      const ack = await session.command({
        type: "chat.send",
        projectId: props.projectId,
        ...(text.trim() ? { text } : {}),
        ...(photoIds.length ? { photoIds } : {}),
        ...(itemIds.length ? { itemIds } : {}),
      });
      if (!ack.ok) throw new Error(ack.error);
      return true;
    } catch (caught) {
      setChatError(describeError(caught));
      return false;
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  async function submitChat() {
    voice.cancel();
    openChatForMessage();
    const text = promptRef.current?.value ?? "";
    const photos = attached.photos;
    const itemIds = referencedItems.map((item) => item.id);
    if (await sendChat({ text, photos, itemIds })) {
      setReferenceIds((current) =>
        current.filter((id) => !itemIds.includes(id)),
      );
      if (promptRef.current?.value === text) promptRef.current.value = "";
      for (const photo of photos) attached.removePhoto(photo.id);
    }
  }

  async function stopChat() {
    try {
      const ack = await session.command({
        type: "chat.stop",
        projectId: props.projectId,
      });
      if (!ack.ok) throw new Error(ack.error);
    } catch (caught) {
      setChatError(describeError(caught));
    }
  }

  function commitEmitter(input: { itemId: string; emitter: Light["emitter"] }) {
    const item = session.stores.projects
      .getState()
      .opened[props.projectId]?.project.scene.items.find(
        (entry) => entry.id === input.itemId,
      );
    if (
      !item?.light ||
      (["x", "y", "z"] as const).every(
        (axis) => item.light?.emitter[axis] === input.emitter[axis],
      )
    )
      return;
    history.apply({
      type: "item.update",
      itemId: input.itemId,
      patch: { light: { ...item.light, emitter: input.emitter } },
    });
  }

  const selectedInspector =
    shownSelectedItem === undefined
      ? undefined
      : {
          projectId: props.projectId,
          item: shownSelectedItem,
          items: currentSelectedItemIds.flatMap(
            (id) =>
              shownProject?.scene.items.filter((item) => item.id === id) ?? [],
          ),
          wallLabel: (() => {
            const placement = shownSelectedItem.placement;
            if (placement.kind !== "wall") return undefined;
            const index =
              project?.scene.room.walls.findIndex(
                (wall) => wall.id === placement.wallId,
              ) ?? -1;
            return index < 0
              ? undefined
              : t("editor.room-panel.wall-number-title", { number: index + 1 });
          })(),
          designerBusy: chatBusy,
          onSendDesignerRequest: sendChat,
          job: selectedJob,
          onBulbFieldChange: setBulbField,
          onUpdate: updateSelected,
          onPreviewColor: previewSelectedColor,
          onDuplicate: duplicateSelected,
          onMirror: mirrorSelected,
          onSetLightsOn: setSelectedLightsOn,
          onDuplicateMirrored: duplicateMirroredSelected,
          onDelete: deleteSelected,
        };

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative h-dvh w-screen overflow-hidden">
        <ItemHoverContext value={hoveredChatItemId}>
          <SceneCanvas
            chromeShown={!isChromeHidden}
            bulbField={bulbField}
            onCommitEmitter={commitEmitter}
            walking={isWalking}
            lensMm={lensMm}
            project={shownProject}
            labelsShown={labelsShown}
            gridShown={gridShown}
            snapping={snapping}
            frameTarget={frameTarget}
            getItem={(itemId) =>
              session.stores.projects
                .getState()
                .opened[props.projectId]?.project.scene.items.find(
                  (entry) => entry.id === itemId,
                )
            }
            onPreviewPlacement={setPlacementPreview}
            frameRequest={frameRequest}
            tool={tool}
            selectedItemId={selectedItem?.id}
            selectedItemIds={currentSelectedItemIds}
            selectedSurfaceId={selectedSurfaceId}
            onSelectSurface={selectSurface}
            unconfirmedItemIds={unconfirmedItemIds}
            jobs={jobs}
            onCameraReport={handleCameraReport}
            onPointerMissed={clearSelection}
            onSelect={selectItem}
            focusRef={focusCanvasRef}
            contextMenuOpen={
              contextTarget !== undefined &&
              selectedItem?.id === contextTarget.itemId
            }
            onOpenContextMenu={openContextMenu}
            onCloseContextMenu={closeContextMenu}
            onCommitPlacement={commitPlacement}
            takeSnapshotRef={takeSnapshotRef}
            readRenderViewRef={readRenderViewRef}
          />
        </ItemHoverContext>
        {(!isValidId || openError !== undefined) && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-y-3">
              <p className="type-empty-headline">
                {t("editor.editor-shell.project-not-found")}
              </p>
              {openError !== undefined && (
                <p className="text-ink-dim">{openError}</p>
              )}
              <Link href="/" className="text-ink-dim hover:text-ink">
                {t("editor.editor-shell.back-to-projects")}
              </Link>
            </div>
          </div>
        )}
        {snapshotPhoto && (
          <SnapshotPhotoModal
            projectId={props.projectId}
            png={snapshotPhoto.png}
            view={snapshotPhoto.view}
            onClose={() => setSnapshotPhoto(undefined)}
            onQueued={() => openChat("jobs")}
          />
        )}
        <div
          data-testid="chrome"
          className={isChromeHidden ? "invisible" : undefined}
        >
          <TopStrip
            projectId={props.projectId}
            walking={isWalking}
            lensMm={lensMm}
            onLensChange={setLensMm}
            onLensRelease={() => focusCanvasRef.current?.()}
            onToggleWalk={() => {
              setContextTarget(undefined);
              setIsWalking((current) => !current);
              focusCanvasRef.current?.();
            }}
            onOpenShortcuts={() => setIsShortcutsOpen(true)}
            onOpenCommands={() => setIsPaletteOpen(true)}
            onNavigateToSettings={() => {
              if (isSample && activeTourStep?.kind === "settings")
                closeTour(false);
            }}
            name={project?.name ?? "…"}
            dimensions={(() => {
              if (project !== undefined) {
                return formatRoomSize({ room: project.scene.room, locale });
              }
              return !isValidId || openError !== undefined
                ? "—"
                : t("editor.opening");
            })()}
            labelsShown={labelsShown}
            onToggleLabels={() => setLabelsShown((current) => !current)}
            onToggleGrid={() => setGridShown((current) => !(current ?? true))}
            gridShown={gridShown}
            snapping={snapping}
            onToggleSnapping={() =>
              setSnapping((current) => !(current ?? true))
            }
            chatOpen={isChatOpen}
            onToggleChat={() => setIsChatOpen((current) => !current)}
            popoverRef={popoverRef}
            onToggleProjectMenu={() => togglePopover("project")}
            onToggleRoomPanel={() => {
              if (project !== undefined) togglePopover("room");
            }}
            projectMenu={
              popover === "project" && project !== undefined ? (
                <ProjectMenu
                  key="project-menu"
                  name={project.name}
                  projectId={props.projectId}
                  onRename={renameProject}
                  onExport={() => void exportCurrent()}
                  onImport={(archive) => void importArchive(archive)}
                />
              ) : undefined
            }
            roomPanel={
              popover === "room" && shownProject !== undefined ? (
                <RoomPanel
                  library={surfaceLibrary}
                  projectId={props.projectId}
                  key="room-panel"
                  room={shownProject.scene.room}
                  onResize={resizeRoom}
                  onSurfaceColor={setSurfaceColor}
                  selectedSurfaceId={selectedSurfaceId}
                  onSelectSurface={selectSurface}
                  onSurfaceMaterial={setSurfaceMaterial}
                  onCancelPreview={cancelPreview}
                  onApplyWalls={applyToWalls}
                />
              ) : undefined
            }
          />
          <ToolRail
            tool={tool}
            addButtonRef={addButtonRef}
            add={
              isAddOpen && project
                ? {
                    library: objectsLibrary,
                    items: project.scene.items,
                    chargingPort: chargingPortType.entry,
                    variantAvailable: selectedItem?.model.kind === "asset",
                    onFromPhoto: addFromPhoto,
                    onFromPrompt: addFromPrompt,
                    onVariant: addVariantOfSelection,
                    onAddChargingPort: (entry) => {
                      chargingPortType.remember(entry);
                      addChargingPort(entry);
                    },
                    onPlace: (object) => {
                      setIsAddOpen(false);
                      placeLibraryObject(object);
                    },
                    onClose: () => {
                      setIsAddOpen(false);
                      addButtonRef.current?.focus();
                    },
                    onDismiss: () => setIsAddOpen(false),
                  }
                : undefined
            }
            onToolChange={setTool}
            onToggleAdd={() => {
              if (!project) return;
              if (!isAddOpen) objectsLibrary.refresh();
              setIsAddOpen((current) => !current);
            }}
          />
          {selectedInspector !== undefined && !isChatOpen && (
            <Inspector
              key={selectedInspector.item.id}
              {...selectedInspector}
              onClose={clearSelection}
            />
          )}
          <BottomLeft
            sheetLabel={t("editor.sheet-label", {
              name: `\u2068${project?.name ?? "…"}\u2069`,
            })}
            project={project}
            jobs={Object.values(jobs).filter(
              (job) =>
                job.kind === "install" || job.projectId === props.projectId,
            )}
            onOpenJobs={(jobId) => {
              setSelectedJobId(jobId);
              openChat("jobs");
            }}
          />
          <BottomRight
            tour={
              isSample && !isWalking ? (
                <button
                  ref={tourButton}
                  type="button"
                  data-chrome
                  className="press relative z-control h-7 whitespace-nowrap rounded-panel border border-line bg-panel px-2 hover:border-line-strong"
                  onClick={() => showTourStep("orbit")}
                >
                  {t("editor.editor-shell.room-tour")}
                </button>
              ) : undefined
            }
            status={
              status && {
                kind: status.kind,
                text: t(status.key, status.values),
              }
            }
            snapshotBusy={isSnapshotBusy}
            chatOpen={isChatOpen}
            onSnapshot={() => void takeSnapshot()}
          />
          <LayoutGroup>
            <AnimatePresence>
              {isChatOpen && (
                <ChatPanel
                  key="chat-panel"
                  tab={chatTab}
                  projectId={props.projectId}
                  selectedJobId={selectedJobId}
                  error={chatError}
                  onStop={() => void stopChat()}
                  objects={
                    project
                      ? {
                          projectId: props.projectId,
                          library: objectsLibrary,
                          items: project.scene.items,
                          selected: selectedInspector,
                          onSelect: (input) => {
                            selectItem(input);
                            setFrameTarget("selection");
                            setFrameRequest((current) => current + 1);
                          },
                          onPlace: placeLibraryObject,
                          onEdit: () => openChat("selected"),
                          onSendToChat: sendSelectedToChat,
                          referenceLimitReached:
                            currentReferenceIds.length >= maxItemReferences &&
                            !currentReferenceIds.includes(selectedItemId ?? ""),
                          view: objectsView,
                          onViewChange: (update) =>
                            setObjectsViews((current) => ({
                              ...current,
                              [props.projectId]: update(
                                current[props.projectId] ?? initialObjectsView,
                              ),
                            })),
                        }
                      : undefined
                  }
                  actions={
                    project
                      ? {
                          projectId: props.projectId,
                          scene: project.scene,
                          busy: chatBusy,
                          onSend: sendChat,
                          onApply: applyItemCommand,
                          onSelect: setSelectedItemId,
                          onHover: setHoveredChatItemId,
                          onAttach: () => {
                            document
                              .querySelector<HTMLButtonElement>(
                                "[data-attach-photo]",
                              )
                              ?.click();
                          },
                          onFocus: (itemId) => {
                            setSelectedItemId(itemId);
                            setFrameTarget("selection");
                            setFrameRequest((current) => current + 1);
                          },
                        }
                      : undefined
                  }
                  selected={selectedInspector}
                  onTabChange={setChatTab}
                />
              )}
            </AnimatePresence>
            <Composer
              docked={isChatOpen}
              busy={chatBusy}
              inputRef={promptRef}
              photos={attached.photos}
              items={project?.scene.items ?? []}
              referencedItems={referencedItems}
              onAddItem={addItemReference}
              onRemoveItem={removeItemReference}
              onAddFiles={attached.addFiles}
              onRemovePhoto={attached.removePhoto}
              onSubmit={() => void submitChat()}
              voice={voice}
            />
          </LayoutGroup>
          {isSample &&
            !isWalking &&
            !isChromeHidden &&
            activeTourStep &&
            !(activeTourStep.kind === "wall" && popover === "room") &&
            !(activeTourStep.kind === "add" && isAddOpen) && (
              <SampleCoachmark
                key={activeTourStep.kind}
                step={activeTourStep}
                target={(() => {
                  if (
                    activeTourStep.kind === "orbit" ||
                    activeTourStep.kind === "lamp"
                  )
                    return "tools";
                  if ("tab" in activeTourStep && !isChatOpen)
                    return "chat-toggle";
                  return activeTourStep.kind;
                })()}
                stepNumber={tourIndex + 1}
                stepCount={tourSteps.length}
                lamp={
                  activeTourStep.kind === "lamp" && sampleLampLight
                    ? { on: sampleLampLight.on, onToggle: toggleSampleLamp }
                    : undefined
                }
                chat={
                  activeTourStep.kind === "chat"
                    ? {
                        exerciseKey: project?.scene.items.some(
                          (item) => item.id === "chair",
                        )
                          ? activeTourStep.chairExercise
                          : activeTourStep.roomExercise,
                        setupHref: `/settings?from=${props.projectId}${designerCli ? `&feature=${designerCli}` : ""}#setup`,
                        onFocusMessage: focusTourMessage,
                      }
                    : undefined
                }
                onContinue={continueTour}
                onDismiss={() => closeTour()}
              />
            )}
        </div>
        {contextTarget && selectedItem?.id === contextTarget.itemId && (
          <ObjectContextMenu
            onFrame={() => {
              setFrameTarget("room");
              setFrameRequest((current) => current + 1);
            }}
            key={`${contextTarget.itemId}:${contextTarget.xPx}:${contextTarget.yPx}`}
            target={contextTarget}
            referenceLimitReached={
              currentReferenceIds.length >= maxItemReferences &&
              !currentReferenceIds.includes(selectedItem.id)
            }
            item={selectedItem}
            items={selectedItems}
            onColor={() => {
              setIsChromeHidden(false);
              setIsChatOpen(false);
            }}
            projectId={props.projectId}
            job={selectedJob}
            designerBusy={chatBusy}
            onSendDesignerRequest={sendChat}
            onUpdate={updateSelected}
            onEdit={() => {
              setIsChromeHidden(false);
              openChat("selected");
            }}
            onSendToChat={sendSelectedToChat}
            onDuplicate={duplicateSelected}
            onDuplicateMirrored={duplicateMirroredSelected}
            onMirror={mirrorSelected}
            onSetLightsOn={setSelectedLightsOn}
            onDelete={deleteSelected}
            onClose={closeContextMenu}
            onFocusCanvas={focusCanvas}
          />
        )}
        <input
          ref={importInputRef}
          type="file"
          accept=".iplan"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.item(0);
            if (file) void importArchive(file);
            event.currentTarget.value = "";
          }}
        />
        {isPaintingWalls && project && (
          <WallPaintDialog
            projectId={props.projectId}
            room={project.scene.room}
            onPreview={setWallPaintPreview}
            onClose={() => {
              setIsPaintingWalls(false);
              setWallPaintPreview(undefined);
            }}
            onApply={(paint) => {
              const applied = history.applyGroup(
                project.scene.room.walls
                  .filter((wall) => wall.kind !== "open")
                  .map((wall) => ({
                    type: "surface.update",
                    surfaceId: wall.id,
                    color: paint.color,
                    material: paint,
                  })),
              );
              if (applied) {
                setIsPaintingWalls(false);
                setWallPaintPreview(undefined);
              }
            }}
          />
        )}
        {isShortcutsOpen && (
          <ShortcutSheet
            walking={isWalking}
            onClose={() => setIsShortcutsOpen(false)}
          />
        )}
        {isPaletteOpen && (
          <CommandPalette
            onClose={() => setIsPaletteOpen(false)}
            actions={[
              {
                id: "mirror",
                label: t("editor.editor-shell.mirror"),
                run: mirrorSelected,
                disabled: !selectedItem,
              },
              {
                id: "duplicate-mirrored",
                label: t("editor.editor-shell.duplicate-mirrored"),
                run: duplicateMirroredSelected,
                disabled:
                  !selectedItem || selectedItem.model.kind === "pending",
              },
              {
                id: "select-floor",
                label: t("editor.editor-shell.select-floor"),
                run: () => selectSurface("floor"),
                disabled: !project,
              },
              {
                id: "select-ceiling",
                label: t("editor.editor-shell.select-ceiling"),
                run: () => selectSurface("ceiling"),
                disabled: !project,
              },
              {
                id: "paint-walls",
                label: t("editor.editor-shell.paint-all-walls"),
                run: () => {
                  closePopover();
                  setIsPaintingWalls(true);
                },
                disabled: !project,
              },
              {
                id: "select",
                label: t("editor.editor-shell.select-tool"),
                run: () => setTool("select"),
              },
              {
                id: "rotate",
                label: t("editor.editor-shell.rotate-tool"),
                run: () => setTool("rotate"),
              },
              {
                id: "add",
                label: t("editor.editor-shell.add-charging-port"),
                run: () => addChargingPort(chargingPortType.entry),
                disabled: !project,
              },
              {
                id: "snapshot",
                label: t("editor.editor-shell.snapshot-save-png"),
                run: () => void takeSnapshot(),
                disabled: !project || isSnapshotBusy,
              },
              {
                id: "export",
                label: t("editor.editor-shell.export-project"),
                run: () => void exportCurrent(),
                disabled: !project,
              },
              {
                id: "import",
                label: t("editor.editor-shell.import-project"),
                run: () => importInputRef.current?.click(),
              },
              {
                id: "labels",
                label: t("editor.editor-shell.toggle-labels"),
                run: () => setLabelsShown((current) => !current),
              },
              {
                id: "grid",
                label: t("editor.editor-shell.toggle-grid"),
                run: () => setGridShown((current) => !(current ?? true)),
              },
              {
                id: "snap",
                label: t("editor.editor-shell.toggle-snapping"),
                run: () => setSnapping((current) => !(current ?? true)),
              },
              {
                id: "chat",
                label: t("editor.editor-shell.open-chat"),
                run: () => openChat("chat"),
              },
              {
                id: "objects",
                label: t("editor.editor-shell.open-objects"),
                run: () => openChat("objects"),
              },
              {
                id: "settings",
                label: t("editor.editor-shell.settings"),
                run: () => router.push(`/settings?from=${props.projectId}`),
              },
            ]}
          />
        )}
        {isDraggingFiles && <DropFrame />}
      </main>
    </MotionConfig>
  );
}
