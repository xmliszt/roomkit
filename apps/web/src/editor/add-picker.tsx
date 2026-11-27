"use client";

import type { CatalogEntry } from "@planner/shared/src/catalog/catalog-entry.ts";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import type { ObjectsLibraryResult } from "@planner/shared/src/protocol/objects-library-result-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { motion, useIsPresent } from "motion/react";
import Image from "next/image";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { getDaemonUrl } from "../daemon-http/get-daemon-url.ts";
import { formatDecimal } from "../i18n/format-decimal.ts";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import type { useObjectsLibrary } from "../objects/use-objects-library.ts";
import { containsFloatingTarget } from "../ui/contains-floating-target.ts";
import { FloatingPopover } from "../ui/floating-popover.tsx";
import { panelEnter, panelExit } from "./interface-motion.ts";

type LibraryObject = ObjectsLibraryResult["objects"][number];
type AddPickerProps = {
  triggerRef: RefObject<HTMLButtonElement | null>;
  library: ReturnType<typeof useObjectsLibrary>;
  items: Item[];
  chargingPort: CatalogEntry;
  variantAvailable: boolean;
  onFromPhoto: () => void;
  onFromPrompt: () => void;
  onVariant: () => void;
  onAddChargingPort: (entry: CatalogEntry) => void;
  onPlace: (object: LibraryObject) => void;
  onClose: () => void;
  onDismiss: () => void;
};
type Option = {
  key: string;
  group: "start" | "built-in" | "models";
  label: string;
  detail?: string;
  thumbnailUrl?: string;
  disabled: boolean;
  choose: () => void;
};

const groupLabels = {
  start: "editor.add-picker.start-from",
  "built-in": "editor.add-picker.built-in",
  models: "editor.add-picker.project-models",
} satisfies { [group in Option["group"]]: string };

export function AddPicker(props: AddPickerProps) {
  const t = useMessages();
  const locale = useLocale();

  function formatSize(size: { width: number; height: number; depth: number }) {
    const dimensions = [size.width, size.height, size.depth]
      .map((value) => formatDecimal({ value, locale }))
      .join(" × ");
    return `${dimensions} m`;
  }
  const [search, setSearch] = useState("");
  const [activeKey, setActiveKey] = useState<string>();
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const isPresent = useIsPresent();
  const dismissRef = useRef(props.onDismiss);
  useEffect(() => {
    dismissRef.current = props.onDismiss;
  });
  useEffect(() => {
    if (!isPresent) return;
    input.current?.focus();
    function closeOnOutsidePointerDown(event: PointerEvent) {
      const addAnchor = props.triggerRef.current;
      if (
        !containsFloatingTarget({
          root: container.current,
          target: event.target,
        }) &&
        !addAnchor?.contains(event.target instanceof Node ? event.target : null)
      )
        dismissRef.current();
    }
    window.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () =>
      window.removeEventListener(
        "pointerdown",
        closeOnOutsidePointerDown,
        true,
      );
  }, [isPresent, props.triggerRef]);

  const query = search.trim().toLocaleLowerCase(locale);
  const itemsByAssetId = Object.groupBy(
    props.items.filter((item) => item.model.kind === "asset"),
    (item) => (item.model.kind === "asset" ? item.model.assetId : ""),
  );
  const allOptions: Option[] = [
    {
      key: "photo",
      group: "start",
      label: t("editor.add-picker.from-photo"),
      disabled: false,
      choose: props.onFromPhoto,
    },
    {
      key: "prompt",
      group: "start",
      label: t("editor.add-picker.from-prompt"),
      disabled: false,
      choose: props.onFromPrompt,
    },
    {
      key: "variant",
      group: "start",
      label: t("editor.add-picker.variant-of-selection"),
      ...(props.variantAvailable
        ? {}
        : { detail: t("editor.add-picker.select-object-first") }),
      disabled: !props.variantAvailable,
      choose: props.onVariant,
    },
    ...[
      props.chargingPort,
      ...CHARGING_PORT_TYPES.filter(
        (entry) => entry.typeId !== props.chargingPort.typeId,
      ),
    ].map(
      (entry): Option => ({
        key: `built-in:${entry.assetId}`,
        group: "built-in",
        label: `${t("editor.charging-port.name")} · ${t(`editor.charging-port.type.${entry.typeId}`)}`,
        detail: formatSize(entry.sizeM),
        thumbnailUrl: getDaemonUrl({
          path: `/catalog/${entry.assetId}/thumb.png`,
        }),
        disabled: false,
        choose: () => props.onAddChargingPort(entry),
      }),
    ),
    ...(props.library.result.kind === "ready"
      ? props.library.result.objects
      : []
    )
      .filter((object) => !object.builtIn)
      .map((object): Option => {
        const uses = itemsByAssetId[object.assetId] ?? [];
        const name = uses.at(0)?.name ?? object.name;
        return {
          key: `model:${object.assetId}`,
          group: "models",
          label: name,
          detail: t("editor.add-picker.in-room", {
            dimensions: formatSize(object.nativeSizeM),
            count: uses.length,
          }),
          thumbnailUrl: getDaemonUrl({ path: object.thumbUrl }),
          disabled: false,
          choose: () => props.onPlace({ ...object, name }),
        };
      }),
  ];
  const options = allOptions.filter((option) =>
    option.label.toLocaleLowerCase(locale).includes(query),
  );
  const enabled = options.filter((option) => !option.disabled);
  const active =
    enabled.find((option) => option.key === activeKey) ?? enabled.at(0);

  function moveActive(step: number) {
    if (enabled.length === 0) return;
    const index = active ? enabled.indexOf(active) : -1;
    const next = enabled.at((index + step + enabled.length) % enabled.length);
    if (!next) return;
    setActiveKey(next.key);
    document
      .getElementById(optionId(next))
      ?.scrollIntoView({ block: "nearest" });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !isPresent) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        return;
      case "Enter":
        event.preventDefault();
        active?.choose();
        return;
      case "Escape":
        event.preventDefault();
        props.onClose();
        return;
      case "Tab":
        props.onDismiss();
        return;
      default:
        return;
    }
  }

  function optionId(option: Option) {
    return `${listId}-${option.key}`;
  }

  function renderGroup(section: {
    group: Option["group"];
    status?: ReactNode;
  }) {
    const { group, status } = section;
    const groupOptions = options.filter((option) => option.group === group);
    if (groupOptions.length === 0 && status === undefined) return null;
    return (
      <fieldset className="m-0 flex min-w-0 flex-col gap-y-0.5 border-0 p-0">
        <legend className="type-label px-1 pt-1">
          {t(groupLabels[group])}
        </legend>
        {groupOptions.map((option) => (
          <div
            key={option.key}
            id={optionId(option)}
            role="option"
            data-option-key={option.key}
            aria-selected={option === active}
            aria-disabled={option.disabled}
            tabIndex={-1}
            onPointerMove={() => {
              if (!option.disabled) setActiveKey(option.key);
            }}
            className="rounded-panel aria-disabled:text-ink-dim aria-selected:bg-accent-soft"
          >
            <button
              type="button"
              tabIndex={-1}
              disabled={option.disabled}
              onClick={(event) => {
                if (!event.ctrlKey && isPresent) option.choose();
              }}
              className="picker-row w-full cursor-default px-1 text-left"
            >
              {option.thumbnailUrl && (
                <Image
                  unoptimized
                  width={32}
                  height={32}
                  crossOrigin="anonymous"
                  alt=""
                  src={option.thumbnailUrl}
                  className="size-8 shrink-0 border border-line object-contain"
                />
              )}
              <span className="picker-title">
                <span title={option.label}>{option.label}</span>
                {option.detail && (
                  <span className="text-[11px] text-ink-dim tabular-nums">
                    {option.detail}
                  </span>
                )}
              </span>
            </button>
          </div>
        ))}
        {status}
      </fieldset>
    );
  }

  return (
    <FloatingPopover placement="right" width={300}>
      <motion.div
        ref={container}
        data-editor-popover
        role="dialog"
        aria-label={t("editor.add-picker.add")}
        data-chrome
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1, transition: panelEnter }}
        exit={{ opacity: 0, scale: 0.95, transition: panelExit }}
        style={{ transformOrigin: "left top" }}
        onPointerDown={(event) => {
          if (event.target !== input.current) event.preventDefault();
        }}
        className="panel relative w-full flex max-h-[calc(100vh-160px)] flex-col gap-y-2 p-2"
      >
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label={t("editor.add-picker.search-objects-to-add")}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active) : undefined}
          value={search}
          placeholder={t("editor.add-picker.search-objects")}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setActiveKey(undefined);
          }}
          onKeyDown={handleKeyDown}
          className="h-8 min-w-0 border border-line bg-bg px-2"
        />
        <div
          id={listId}
          role="listbox"
          aria-label={t("editor.add-picker.objects-to-add")}
          className="flex min-h-0 flex-col gap-y-2 overflow-y-auto"
        >
          {renderGroup({ group: "start" })}
          {renderGroup({ group: "built-in" })}
          {renderGroup({
            group: "models",
            status:
              props.library.result.kind === "loading" ? (
                <output className="px-1 text-ink-dim">
                  {t("editor.add-picker.loading-models")}
                </output>
              ) : props.library.result.kind === "error" ? (
                <p role="alert" className="px-1 text-danger">
                  {props.library.result.message}
                </p>
              ) : undefined,
          })}
          {options.length === 0 && props.library.result.kind === "ready" && (
            <p className="px-1 text-ink-dim">
              {t("editor.add-picker.no-matching-objects")}
            </p>
          )}
        </div>
      </motion.div>
    </FloatingPopover>
  );
}
