import type { ItemPatch } from "@planner/shared/src/commands/command-schema.ts";
import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { motion, useReducedMotion } from "motion/react";
import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMessages } from "../i18n/use-messages.ts";
import type { GenerationAction } from "./generation/generation-action.ts";
import { getGenerationState } from "./generation/get-generation-state.ts";
import { useGenerationActions } from "./generation/use-generation-actions.ts";
import { getShortcutAction } from "./get-shortcut-action.ts";
import { panelEnter } from "./interface-motion.ts";
import { maxItemReferences } from "./max-item-references.ts";
import type { ObjectContextTarget } from "./object-context-target.ts";
import { ShortcutKeys } from "./shortcut-keys.tsx";

type ObjectContextMenuProps = {
  target: ObjectContextTarget;
  item: Item;
  items?: Item[];
  onColor?: () => void;
  projectId: string;
  job: Job | undefined;
  designerBusy: boolean;
  referenceLimitReached: boolean;
  onSendDesignerRequest: (text: string) => Promise<boolean>;
  onUpdate: (patch: ItemPatch) => boolean;
  onEdit: () => void;
  onFrame: () => void;
  onSendToChat: () => void;
  onDuplicate: () => void;
  onDuplicateMirrored: () => void;
  onMirror: () => void;
  onSetLightsOn: (on: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
  onFocusCanvas: () => void;
};

const itemClass =
  "aligned-row menu-row h-7 w-full border border-line bg-bg px-2.5 py-1 text-start hover:border-line-strong hover:bg-[linear-gradient(var(--accent-soft),var(--accent-soft))] focus:border-line-strong focus:bg-[linear-gradient(var(--accent-soft),var(--accent-soft))] disabled:text-ink-dim disabled:hover:border-line disabled:hover:bg-none disabled:focus:bg-none";

export function ObjectContextMenu(props: ObjectContextMenuProps) {
  const t = useMessages();
  const container = useRef<HTMLDivElement>(null);
  const isMounted = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  const isReducedMotion = useReducedMotion();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [activeIndex, setActiveIndex] = useState(0);
  const { request, alternatives } = useGenerationActions(props);
  const generationState = getGenerationState({
    item: props.item,
    job: props.job,
  });
  const isRunning = generationState === "running";
  const isHeld = generationState === "held";
  const closeRef = useRef(props.onClose);
  useEffect(() => {
    closeRef.current = props.onClose;
  }, [props.onClose]);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    function clampToViewport() {
      if (!element) return;
      element.style.left = `${Math.max(4, Math.min(props.target.xPx, window.innerWidth - element.offsetWidth - 4))}px`;
      element.style.top = `${Math.max(4, Math.min(props.target.yPx, window.innerHeight - element.offsetHeight - 12))}px`;
    }
    clampToViewport();
    const observer = new ResizeObserver(clampToViewport);
    observer.observe(element);
    window.addEventListener("resize", clampToViewport);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", clampToViewport);
    };
  }, [props.target.xPx, props.target.yPx]);
  useEffect(() => {
    container.current
      ?.querySelector<HTMLElement>(
        isFormOpen ? "textarea" : '[role="menuitem"]',
      )
      ?.focus();
  }, [isFormOpen]);
  useEffect(() => {
    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      )
        closeRef.current();
    }
    function closeOnScroll(event: Event) {
      if (
        event.target instanceof Node &&
        container.current?.contains(event.target)
      )
        return;
      closeRef.current();
    }
    function closeOnBlur() {
      closeRef.current();
    }
    window.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    window.addEventListener("wheel", closeOnScroll, true);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener(
        "pointerdown",
        closeOnOutsidePointerDown,
        true,
      );
      window.removeEventListener("wheel", closeOnScroll, true);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, []);
  function closeToCanvas() {
    props.onClose();
    props.onFocusCanvas();
  }
  function runAndClose(action: () => void) {
    closeToCanvas();
    action();
  }
  async function requestGeneration(action: GenerationAction) {
    if (isBusy || isRunning) return;
    setIsBusy(true);
    setError(undefined);
    try {
      await request(action);
      if (isMounted.current) closeToCanvas();
    } catch (caught) {
      if (isMounted.current)
        setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (isMounted.current) setIsBusy(false);
    }
  }
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      !isFormOpen &&
      event.key.toLowerCase() === "f" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) props.onFrame();
      return;
    }
    event.stopPropagation();
    if (!isFormOpen) {
      const action = getShortcutAction({
        key: event.key,
        code: event.code,
        isTyping: false,
        isWalking: false,
        isCommandHeld: event.metaKey || event.ctrlKey,
        isShiftHeld: event.shiftKey,
        isAltHeld: event.altKey,
      });
      if (action?.kind === "duplicate" || action?.kind === "delete") {
        event.preventDefault();
        const menuAction = actions.find((entry) => entry.key === action.kind);
        if (menuAction && !menuAction.disabled) menuAction.run();
        return;
      }
    }
    if (
      isFormOpen &&
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      container.current?.querySelector("form")?.requestSubmit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeToCanvas();
      return;
    }
    if (event.key === "Tab" && !isFormOpen) {
      props.onClose();
      props.onFocusCanvas();
      return;
    }
    if (
      isFormOpen ||
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    )
      return;
    event.preventDefault();
    const items = Array.from(
      container.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    const current =
      document.activeElement instanceof HTMLButtonElement
        ? items.indexOf(document.activeElement)
        : -1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End" || (current < 0 && event.key === "ArrowUp")
          ? items.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items.at(next)?.focus();
  }
  const isMultiSelection = (props.items?.length ?? 0) > 1;
  const lights = (
    isMultiSelection ? (props.items ?? []) : [props.item]
  ).flatMap((item) => (item.light ? [item.light] : []));
  const areAllLightsOn = lights.every((light) => light.on);
  const areAllLocked = isMultiSelection
    ? props.items?.every((item) => item.locked)
    : props.item.locked;
  const actions = [
    {
      key: "colour",
      hidden: !isMultiSelection,
      label: t("editor.object-context-menu.colour"),
      run: () => runAndClose(() => props.onColor?.()),
    },
    {
      key: "edit",
      hidden: isMultiSelection,
      label: t("editor.object-context-menu.edit"),
      run: () => runAndClose(props.onEdit),
    },
    {
      key: "generation",
      hidden: isMultiSelection || generationState === undefined,
      label: isHeld
        ? t("editor.object-context-menu.model-this")
        : t("editor.object-context-menu.regenerate"),
      disabled: isBusy || isRunning,
      run: () =>
        isHeld
          ? void requestGeneration({ kind: "start" })
          : setIsFormOpen(true),
    },
    {
      key: "send-to-chat",
      label: t("editor.object-context-menu.send-to-chat"),
      disabled: props.referenceLimitReached,
      title: props.referenceLimitReached
        ? t(
            "editor.object-context-menu.remove-a-reference-from-the-composer-to-add",
            { maxItemReferences: maxItemReferences },
          )
        : undefined,
      run: () => runAndClose(props.onSendToChat),
    },
    {
      key: "duplicate",
      label: isMultiSelection
        ? t("editor.object-context-menu.duplicate-all")
        : t("editor.object-context-menu.duplicate"),
      disabled: isMultiSelection
        ? props.items?.some((item) => item.model.kind === "pending")
        : props.item.model.kind === "pending",
      shortcut: <ShortcutKeys keys={["command", { letter: "D" }]} />,
      run: () => runAndClose(props.onDuplicate),
    },
    {
      key: "duplicate-mirrored",
      hidden: isMultiSelection,
      label: t("editor.object-context-menu.duplicate-mirrored"),
      disabled: props.item.model.kind === "pending",
      run: () => runAndClose(props.onDuplicateMirrored),
    },
    {
      key: "mirror",
      label: isMultiSelection
        ? t("editor.object-context-menu.mirror-all")
        : t("editor.object-context-menu.mirror"),
      run: () => runAndClose(props.onMirror),
    },
    {
      key: "lock",
      label: isMultiSelection
        ? areAllLocked
          ? t("editor.object-context-menu.unlock-all")
          : t("editor.object-context-menu.lock-all")
        : props.item.locked
          ? t("editor.object-context-menu.unlock")
          : t("editor.object-context-menu.lock"),
      run: () =>
        runAndClose(() => {
          props.onUpdate({ locked: !areAllLocked });
        }),
    },
    {
      key: "light",
      hidden: lights.length === 0,
      label: isMultiSelection
        ? areAllLightsOn
          ? t("editor.object-context-menu.turn-lights-off")
          : t("editor.object-context-menu.turn-lights-on")
        : areAllLightsOn
          ? t("editor.object-context-menu.turn-light-off")
          : t("editor.object-context-menu.turn-light-on"),
      run: () => runAndClose(() => props.onSetLightsOn(!areAllLightsOn)),
    },
    {
      key: "delete",
      label: isMultiSelection
        ? t("editor.object-context-menu.delete-all")
        : t("editor.object-context-menu.delete"),
      shortcut: <ShortcutKeys keys={["delete"]} />,
      run: () => runAndClose(props.onDelete),
    },
  ].filter((action) => !action.hidden);
  return (
    <motion.div
      ref={container}
      data-testid="object-context-menu"
      onKeyDown={handleKeyDown}
      initial={
        isReducedMotion ? false : { opacity: 0, transform: "translateY(8px)" }
      }
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={isReducedMotion ? { duration: 0 } : panelEnter}
      className="fixed z-popover flex w-64 max-w-[calc(100vw-8px)] flex-col gap-y-0.5 text-ink"
      style={{ left: props.target.xPx, top: props.target.yPx }}
    >
      {isFormOpen ? (
        <form
          aria-label={t("editor.object-context-menu.regenerate-name", {
            name: props.item.name,
          })}
          onSubmit={(event) => {
            event.preventDefault();
            void requestGeneration({ kind: "regenerate", notes: notes.trim() });
          }}
          className="flex flex-col gap-y-0.5"
        >
          <label className="flex flex-col gap-y-1 border border-line bg-bg p-2.5">
            {t("editor.object-context-menu.what-should-change-optional")}{" "}
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.currentTarget.value)}
              maxLength={1000}
              rows={3}
              disabled={isBusy}
              className="resize-none border border-line bg-bg p-1"
            />
          </label>
          <button
            type="submit"
            disabled={isBusy || isRunning}
            className={itemClass}
          >
            {t("editor.object-context-menu.regenerate-2")}
          </button>
          <button
            type="button"
            disabled={isBusy || isRunning || alternatives.running}
            className={itemClass}
            onClick={() => void requestGeneration({ kind: "alternatives" })}
          >
            {t("editor.object-context-menu.try-another-version")}
          </button>
        </form>
      ) : (
        <div
          role="menu"
          aria-label={props.item.name}
          className="flex flex-col gap-y-0.5"
        >
          {actions.map((action, index) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              tabIndex={activeIndex === index ? 0 : -1}
              onFocus={() => setActiveIndex(index)}
              disabled={action.disabled}
              title={action.title}
              onClick={action.run}
              className={`${itemClass}${action.key === "delete" ? " text-danger" : ""}`}
            >
              <span className="menu-title truncate">{action.label}</span>
              <span className="menu-shortcut text-ink-dim" aria-hidden="true">
                {action.shortcut}
              </span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="border border-line bg-bg p-2 text-danger">
          {error}
        </p>
      )}
    </motion.div>
  );
}
