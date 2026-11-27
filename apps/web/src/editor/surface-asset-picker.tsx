import type { SurfaceAsset } from "@planner/shared/src/protocol/surface-assets-result-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import Image from "next/image";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { getDaemonUrl } from "../daemon-http/get-daemon-url.ts";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { getSurfaceAssetOptions } from "./get-surface-asset-options.ts";

type SurfaceAssetPickerProps = {
  assets: SurfaceAsset[];
  projectId: string;
  room: Room;
  assetId: string | undefined;
  optional: boolean;
  loading: boolean;
  onChange: (asset: SurfaceAsset | undefined) => void;
};

export function SurfaceAssetPicker(props: SurfaceAssetPickerProps) {
  const t = useMessages();
  const locale = useLocale();
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string>();
  const choices = [
    ...(props.optional
      ? [{ asset: undefined, label: t("editor.surface-asset-picker.none") }]
      : []),
    ...getSurfaceAssetOptions({
      assets: props.assets,
      room: props.room,
      t,
      locale,
    }),
  ];
  const active = Math.max(
    0,
    choices.findIndex(
      (choice) => (choice.asset?.assetId ?? ":none") === activeKey,
    ),
  );
  const selected = choices.find(
    (choice) => choice.asset?.assetId === props.assetId,
  );
  useEffect(() => {
    if (!isOpen) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [isOpen, active, listId]);

  function activate(index: number) {
    const choice = choices.at(index);
    if (choice) setActiveKey(choice.asset?.assetId ?? ":none");
  }
  function open() {
    activate(
      Math.max(
        0,
        choices.findIndex((choice) => choice.asset?.assetId === props.assetId),
      ),
    );
    setOpen(true);
  }
  function choose(index: number) {
    const choice = choices.at(index);
    if (!choice) return;
    props.onChange(choice.asset);
    setOpen(false);
    trigger.current?.focus();
  }
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Escape" && isOpen) {
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        open();
        return;
      }
      setOpen(true);
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? choices.length - 1
            : (active + (event.key === "ArrowDown" ? 1 : -1) + choices.length) %
              choices.length;
      activate(index);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen) choose(active);
      else open();
    } else if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      event.key !== " "
    ) {
      event.preventDefault();
      const index = Array.from(
        { length: choices.length },
        (_, offset) => (active + offset + 1) % choices.length,
      ).find((index) =>
        choices
          .at(index)
          ?.label.toLowerCase()
          .startsWith(event.key.toLowerCase()),
      );
      if (index !== undefined) {
        activate(index);
        setOpen(true);
      }
    }
  }
  function swatch(asset: SurfaceAsset | undefined) {
    return asset ? (
      <Image
        unoptimized
        crossOrigin="anonymous"
        alt=""
        width={24}
        height={24}
        className="size-6 shrink-0 border border-line object-cover"
        src={getDaemonUrl({
          path: `/projects/${props.projectId}/assets/${asset.assetId}/baseColor.png`,
        })}
      />
    ) : undefined;
  }
  return (
    <div ref={root} className="relative flex min-w-0 flex-col gap-y-1">
      <span id={`${listId}-label`}>
        {t("editor.surface-asset-picker.texture")}
      </span>
      <button
        ref={trigger}
        type="button"
        disabled={choices.length === 0}
        role="combobox"
        aria-labelledby={`${listId}-label`}
        aria-haspopup="listbox"
        aria-controls={isOpen ? listId : undefined}
        aria-expanded={isOpen}
        aria-activedescendant={isOpen ? `${listId}-${active}` : undefined}
        className="flex min-h-8 w-full items-center gap-x-2 border border-line bg-bg px-1 text-left"
        onClick={() => (isOpen ? setOpen(false) : open())}
        onKeyDown={handleKeyDown}
      >
        {swatch(selected?.asset)}
        <span className="min-w-0 flex-1 whitespace-normal">
          {selected?.label ??
            (props.loading
              ? t("editor.surface-asset-picker.loading-textures")
              : props.assetId
                ? t("editor.surface-asset-picker.texture-unavailable")
                : t("editor.surface-asset-picker.choose-texture"))}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {isOpen && (
        <div
          id={listId}
          role="listbox"
          aria-labelledby={`${listId}-label`}
          className="flex max-h-60 w-full shrink-0 flex-col overflow-y-auto border border-line bg-bg"
        >
          {choices.map((choice, index) => (
            <div
              key={choice.asset?.assetId ?? ":none"}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={choice.asset?.assetId === props.assetId}
              className={active === index ? "bg-muted" : undefined}
            >
              <button
                type="button"
                tabIndex={-1}
                className="flex min-h-8 w-full items-center gap-x-2 px-1 py-1 text-left"
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => activate(index)}
                onClick={() => choose(index)}
              >
                {swatch(choice.asset)}
                <span>{choice.label}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
