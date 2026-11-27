import type { CatalogEntry } from "@planner/shared/src/catalog/catalog-entry.ts";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import type { ItemPatch } from "@planner/shared/src/commands/command-schema.ts";
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { getDaemonUrl } from "../daemon-http/get-daemon-url.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { containsFloatingTarget } from "../ui/contains-floating-target.ts";
import { FloatingPopover } from "../ui/floating-popover.tsx";
import { panelEnter, panelExit } from "./interface-motion.ts";

type ChargingPortTypePickerProps = {
  entry: CatalogEntry;
  onUpdate: (patch: ItemPatch) => boolean;
};

export function ChargingPortTypePicker(props: ChargingPortTypePickerProps) {
  const t = useMessages();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!isOpen) return;
    selectedRef.current?.focus();
    function handlePointerDown(event: PointerEvent) {
      if (
        !containsFloatingTarget({ root: rootRef.current, target: event.target })
      ) {
        setIsOpen(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isOpen]);

  function closePicker() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function pickType(entry: CatalogEntry) {
    if (
      props.onUpdate({
        model: { kind: "asset", assetId: entry.assetId },
        sizeM: entry.sizeM,
      })
    )
      closePicker();
  }

  return (
    <fieldset
      ref={rootRef}
      aria-label={t("editor.charging-port-type-picker.charging-port-type")}
      onBlur={(event) => {
        if (
          !containsFloatingTarget({
            root: event.currentTarget,
            target: event.relatedTarget,
          })
        )
          setIsOpen(false);
      }}
      className="relative aligned-row"
    >
      <span className="shrink-0 text-ink-dim">
        {t("editor.charging-port-type-picker.type")}
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t(
          "editor.charging-port-type-picker.change-charging-port-type",
        )}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? dialogId : undefined}
        title={t(`editor.charging-port.type.${props.entry.typeId}`)}
        onClick={() => setIsOpen((current) => !current)}
        className="press flex h-7 min-w-0 items-center gap-x-1 rounded-panel border border-line px-1.5 hover:border-line-strong"
      >
        <span className="truncate">
          {t(`editor.charging-port.type.${props.entry.typeId}`)}
        </span>
        <ChevronDown
          aria-hidden="true"
          size={12}
          strokeWidth={1.5}
          className="shrink-0"
        />
      </button>
      <AnimatePresence>
        {isOpen && (
          <FloatingPopover placement="below">
            <motion.div
              id={dialogId}
              role="dialog"
              aria-label={t(
                "editor.charging-port-type-picker.charging-port-type",
              )}
              initial={{
                opacity: 0,
                scale: reduceMotion ? 1 : 0.95,
                y: reduceMotion ? 0 : 8,
              }}
              animate={{ opacity: 1, scale: 1, y: 0, transition: panelEnter }}
              exit={{
                opacity: 0,
                scale: reduceMotion ? 1 : 0.95,
                y: reduceMotion ? 0 : 4,
                transition: panelExit,
              }}
              style={{ transformOrigin: "right top", background: "var(--bg)" }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  closePicker();
                }
              }}
              className="panel relative w-full flex max-h-[min(440px,60dvh)] flex-col gap-y-1 overflow-y-auto p-2"
            >
              <div className="type-label px-1">
                {t("editor.charging-port-type-picker.socket-type")}
              </div>
              {CHARGING_PORT_TYPES.map((entry) => (
                <button
                  key={entry.typeId}
                  ref={
                    entry.assetId === props.entry.assetId
                      ? selectedRef
                      : undefined
                  }
                  type="button"
                  aria-pressed={entry.assetId === props.entry.assetId}
                  onClick={() => pickType(entry)}
                  className="press flex min-h-12 shrink-0 items-center gap-x-2 rounded-panel px-1 py-1 text-left hover:bg-accent-soft aria-pressed:bg-accent-soft aria-pressed:text-accent"
                >
                  <Image
                    src={getDaemonUrl({
                      path: `/catalog/${entry.assetId}/thumb.png`,
                    })}
                    crossOrigin="anonymous"
                    unoptimized
                    loading="eager"
                    alt=""
                    width={40}
                    height={40}
                    className="size-10 shrink-0 object-contain outline outline-line outline-offset-[-1px]"
                  />
                  <span className="flex-1">
                    {t(`editor.charging-port.type.${entry.typeId}`)}
                  </span>
                  {entry.assetId === props.entry.assetId && (
                    <Check
                      aria-hidden="true"
                      size={12}
                      strokeWidth={1.5}
                      className="shrink-0"
                    />
                  )}
                </button>
              ))}
            </motion.div>
          </FloatingPopover>
        )}
      </AnimatePresence>
    </fieldset>
  );
}
