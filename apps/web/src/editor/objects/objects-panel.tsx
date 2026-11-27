import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { ObjectsLibraryResult } from "@planner/shared/src/protocol/objects-library-result-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import Image from "next/image";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { AssetPreview } from "../../chat/asset-preview.tsx";
import { getDaemonUrl } from "../../daemon-http/get-daemon-url.ts";
import { formatDecimal } from "../../i18n/format-decimal.ts";
import { useLocale } from "../../i18n/use-locale.ts";
import { useMessages } from "../../i18n/use-messages.ts";
import { getAssetUrl } from "../../items/get-asset-url.ts";
import { getLightState } from "../../items/get-light-state.ts";
import type { useObjectsLibrary } from "../../objects/use-objects-library.ts";
import { usePlannerSession } from "../../planner/use-planner-session.ts";
import { getGenerationState } from "../generation/get-generation-state.ts";
import { getItemGenerationJob } from "../generation/get-item-generation-job.ts";
import { InspectorBody } from "../inspector-body.tsx";
import type { ItemSelection } from "../item-selection.ts";
import { InspectPreview } from "./inspect-preview.tsx";
import { ObjectSources } from "./object-sources.tsx";
import type { ObjectsPanelView } from "./objects-panel-view.ts";

type LibraryObject = ObjectsLibraryResult["objects"][number];
type ObjectsPanelProps = {
  projectId: string;
  library: ReturnType<typeof useObjectsLibrary>;
  items: Item[];
  selected: ComponentProps<typeof InspectorBody> | undefined;
  onSelect: (selection: ItemSelection) => void;
  onPlace: (object: LibraryObject) => void;
  onEdit: () => void;
  onSendToChat: () => void;
  referenceLimitReached: boolean;
  view: ObjectsPanelView;
  onViewChange: (update: (view: ObjectsPanelView) => ObjectsPanelView) => void;
};
type Entry =
  | { kind: "model"; object: LibraryObject; items: Item[] }
  | { kind: "item"; item: Item };
const buttonClass =
  "press min-h-7 border border-line px-2 text-left hover:border-line-strong disabled:text-ink-dim";

function getEntryItems(entry: Entry) {
  return entry.kind === "item" ? [entry.item] : entry.items;
}

function getEntryName(entry: Entry) {
  return entry.kind === "item"
    ? entry.item.name
    : (entry.items.at(0)?.name ?? entry.object.name);
}

function getEntryKey(entry: Entry) {
  return entry.kind === "item"
    ? `item:${entry.item.id}`
    : `asset:${entry.object.assetId}`;
}

function getRowState(options: { item: Item; job: Job | undefined }) {
  const state = getGenerationState(options);
  switch (state) {
    case "running":
      return options.job?.stage === "queued" ? "queued" : "generating";
    case "held":
      return "held";
    case "failed":
      return "failed";
    case "ready":
    case undefined:
      return "ready";
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

export function ObjectsPanel(props: ObjectsPanelProps) {
  const t = useMessages();
  const locale = useLocale();
  const library = props.library;
  const session = usePlannerSession();
  const jobs = useStore(session.stores.jobs, (state) => state.jobs);
  const chat = useStore(
    session.stores.activity,
    (state) => state.chats[props.projectId],
  );
  const { filter, search, expanded, removed } = props.view;
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  function updateView(patch: Partial<ObjectsPanelView>) {
    props.onViewChange((view) => ({ ...view, ...patch }));
  }
  const jobList = Object.values(jobs);
  const rowStates = Object.fromEntries(
    props.items.map((item) => {
      const job = getItemGenerationJob({
        projectId: props.projectId,
        item,
        jobs: jobList,
        messages: chat?.messages ?? [],
      });
      return [item.id, { job, state: getRowState({ item, job }) }];
    }),
  );
  const itemsByAssetId = Object.groupBy(
    props.items.filter((item) => item.model.kind === "asset"),
    (item) => (item.model.kind === "asset" ? item.model.assetId : ""),
  );
  async function setArchived(input: {
    object: LibraryObject;
    archived: boolean;
  }) {
    setBusy(true);
    setError(undefined);
    try {
      await library.setArchived({
        assetId: input.object.assetId,
        archived: input.archived,
      });
      updateView({ removed: input.archived ? input.object : undefined });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }
  const objects =
    library.result.kind === "ready"
      ? filter === "hidden"
        ? library.result.archived
        : library.result.objects
      : [];
  const libraryAssetIds = new Set(objects.map((object) => object.assetId));
  const shownRemoved =
    removed &&
    library.result.kind === "ready" &&
    !library.result.objects.some((object) => object.assetId === removed.assetId)
      ? removed
      : undefined;
  const entries: Entry[] = [
    ...(filter === "hidden"
      ? []
      : props.items
          .filter(
            (item) =>
              item.model.kind === "pending" ||
              !libraryAssetIds.has(item.model.assetId),
          )
          .map((item): Entry => ({ kind: "item", item }))),
    ...objects.map(
      (object): Entry => ({
        kind: "model",
        object,
        items:
          filter === "hidden" ? [] : (itemsByAssetId[object.assetId] ?? []),
      }),
    ),
  ];
  const shown = entries.filter((entry) => {
    const items = getEntryItems(entry);
    const name = getEntryName(entry);
    return (
      [name, ...items.map((item) => item.name)].some((name) =>
        name.toLowerCase().includes(search.trim().toLowerCase()),
      ) &&
      (filter !== "attention" ||
        items.some((item) =>
          ["held", "failed"].includes(rowStates[item.id]?.state ?? "ready"),
        ))
    );
  });
  const selectedRowKey = (() => {
    const entry = shown.find((entry) =>
      getEntryItems(entry).some(
        (item) =>
          (props.selected?.items ?? []).some(
            (selected) => selected.id === item.id,
          ) || item.id === props.selected?.item.id,
      ),
    );
    return entry && getEntryKey(entry);
  })();
  useEffect(() => {
    if (selectedRowKey === undefined) return;
    list.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedRowKey]);
  const removedName = shownRemoved?.name;
  useEffect(() => {
    if (removedName !== undefined) undoButton.current?.focus();
  }, [removedName]);
  return (
    <section
      aria-label={t("editor.objects-panel.project-objects")}
      className="flex flex-col gap-y-3"
    >
      <label className="flex flex-col gap-y-1">
        <span className="type-label">
          {t("editor.objects-panel.search-objects")}
        </span>
        <input
          type="search"
          value={search}
          onChange={(event) =>
            updateView({ search: event.currentTarget.value })
          }
          className="h-8 min-w-0 border border-line bg-bg px-2"
        />
      </label>
      <fieldset
        className="flex flex-wrap gap-x-2 gap-y-1"
        aria-label={t("editor.objects-panel.object-filters")}
      >
        {(
          [
            { value: "all", label: t("editor.objects-panel.all") },
            {
              value: "attention",
              label: t("editor.objects-panel.needs-attention"),
            },
            { value: "hidden", label: t("editor.objects-panel.hidden") },
          ] satisfies { value: typeof filter; label: string }[]
        ).map((entry) => (
          <button
            key={entry.value}
            type="button"
            aria-pressed={filter === entry.value}
            className={`${buttonClass} aria-pressed:border-accent aria-pressed:text-accent`}
            onClick={() =>
              updateView({ filter: entry.value, expanded: undefined })
            }
          >
            {entry.label}
          </button>
        ))}
      </fieldset>
      {shownRemoved && (
        <output className="flex items-center justify-between gap-x-2 border border-line p-2">
          <span>
            {shownRemoved.name} {t("editor.objects-panel.hidden-2")}
          </span>
          <button
            ref={undoButton}
            type="button"
            disabled={busy}
            className={buttonClass}
            onClick={() =>
              void setArchived({ object: shownRemoved, archived: false })
            }
          >
            {t("editor.objects-panel.undo")}
          </button>
        </output>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {library.result.kind === "loading" && (
        <output className="text-ink-dim">
          {t("editor.objects-panel.loading-models")}
        </output>
      )}
      {library.result.kind === "error" && (
        <div role="alert" className="flex flex-col gap-y-2 text-danger">
          <p>{library.result.message}</p>
          <button
            type="button"
            onClick={library.refresh}
            className={buttonClass}
          >
            {t("editor.objects-panel.retry-library")}
          </button>
        </div>
      )}
      {library.result.kind === "ready" && shown.length === 0 && (
        <p className="text-ink-dim">
          {filter === "hidden"
            ? t("editor.objects-panel.no-hidden-models")
            : t("editor.objects-panel.no-matching-objects")}
        </p>
      )}
      <div ref={list} className="flex flex-col gap-y-2">
        {shown.map((entry) => {
          const object = entry.kind === "model" ? entry.object : undefined;
          const items = getEntryItems(entry);
          const selected =
            props.selected &&
            items.some(
              (item) =>
                (props.selected?.items ?? []).some(
                  (selected) => selected.id === item.id,
                ) || item.id === props.selected?.item.id,
            )
              ? props.selected
              : undefined;
          const item =
            items.find(
              (item) =>
                selected?.items?.some((member) => member.id === item.id) ||
                item.id === selected?.item.id,
            ) ?? items.at(0);
          const name = getEntryName(entry);
          const key = getEntryKey(entry);
          const size = item?.sizeM ?? object?.nativeSizeM;
          const job = item && rowStates[item.id]?.job;
          const state =
            filter === "hidden"
              ? "hidden"
              : ((item && rowStates[item.id]?.state) ?? "ready");
          const isExpanded =
            expanded === key ||
            items.some((placed) => expanded === `item:${placed.id}`);
          const assetId =
            object?.assetId ??
            (item?.model.kind === "asset" ? item.model.assetId : undefined);
          return (
            <article
              key={key}
              aria-label={name}
              data-selected={selected !== undefined}
              aria-current={selected ? "true" : undefined}
              className="flex min-w-0 flex-col gap-y-2 border border-line p-2 data-[selected=true]:border-accent"
            >
              <div className="object-summary">
                {(() => {
                  if (assetId === undefined || size === undefined)
                    return (
                      <div className="flex size-16 shrink-0 flex-col items-center justify-center gap-y-1 border border-dashed border-line-strong text-[11px] text-ink-dim">
                        <span>
                          {state === "held"
                            ? t("editor.objects-panel.model-this")
                            : t(
                                state === "hidden"
                                  ? "editor.objects-panel.hidden"
                                  : `jobs.stage.${state}`,
                              )}
                        </span>
                        {(state === "queued" || state === "generating") && (
                          <progress
                            aria-label={t(
                              "editor.objects-panel.name-progress",
                              { name: name },
                            )}
                            value={job?.progress ?? 0}
                            max={1}
                            className="h-1 w-12 accent-accent"
                          />
                        )}
                      </div>
                    );
                  if (
                    object &&
                    (filter === "hidden" ||
                      (object.builtIn && items.length === 0))
                  )
                    return (
                      <Image
                        unoptimized
                        width={64}
                        height={64}
                        src={getDaemonUrl({ path: object.thumbUrl })}
                        crossOrigin="anonymous"
                        alt=""
                        className="size-16 shrink-0 border border-line object-contain"
                      />
                    );
                  return (
                    <AssetPreview
                      compact
                      name={name}
                      projectId={props.projectId}
                      assetId={assetId}
                      sizeM={size}
                      thumbnailUrl={
                        object && getDaemonUrl({ path: object.thumbUrl })
                      }
                    />
                  );
                })()}
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={(event) => {
                    const toggle =
                      event.shiftKey || event.metaKey || event.ctrlKey;
                    if (toggle && item) {
                      props.onSelect({ kind: "toggle", itemId: item.id });
                      return;
                    }
                    updateView({ expanded: isExpanded ? undefined : key });
                    if (!isExpanded && item)
                      props.onSelect({ kind: "replace", itemId: item.id });
                  }}
                  className="object-info flex min-w-0 flex-col gap-y-1 text-left"
                >
                  <span className="object-title" dir="auto" title={name}>
                    {name}
                  </span>
                  {size && (
                    <span className="text-[11px] text-ink-dim tabular-nums">
                      {formatDecimal({ value: size.width, locale })} ×{" "}
                      {formatDecimal({ value: size.height, locale })} ×{" "}
                      {formatDecimal({ value: size.depth, locale })} m
                    </span>
                  )}
                  <span
                    className={
                      state === "failed"
                        ? "text-danger"
                        : "text-[11px] text-ink-dim"
                    }
                  >
                    {t(
                      state === "hidden"
                        ? "editor.objects-panel.hidden"
                        : `jobs.stage.${state}`,
                    )}
                    {state === "generating"
                      ? ` · ${Math.round((job?.progress ?? 0) * 100)}%`
                      : ""}{" "}
                    · {items.length} {t("editor.objects-panel.in-room")}{" "}
                    {object?.builtIn ? t("editor.objects-panel.built-in") : ""}
                  </span>
                  {(() => {
                    const lightState = getLightState(items);
                    if (lightState === undefined) return null;
                    return (
                      <span
                        data-testid="light-state"
                        className="flex items-center gap-x-1 text-[11px] text-ink-dim"
                      >
                        <span
                          aria-hidden="true"
                          className={`size-1.5 rounded-full ${lightState.onCount === 0 ? "border border-line-strong" : "bg-accent"}`}
                        />
                        {lightState.total === 1
                          ? t(
                              lightState.onCount === 1
                                ? "editor.light.on"
                                : "editor.light.off",
                            )
                          : t("editor.light.count", {
                              on: lightState.onCount,
                              total: lightState.total,
                            })}
                      </span>
                    );
                  })()}
                </button>
              </div>
              {isExpanded && (
                <div className="flex flex-col gap-y-3 border-t border-line pt-2">
                  {filter === "hidden" && object ? (
                    <button
                      type="button"
                      disabled={busy}
                      className={buttonClass}
                      onClick={() =>
                        void setArchived({ object, archived: false })
                      }
                    >
                      {t("editor.objects-panel.restore")}
                    </button>
                  ) : (
                    <>
                      {assetId !== undefined &&
                        size !== undefined &&
                        !(object?.builtIn && items.length === 0) && (
                          <InspectPreview
                            key={assetId}
                            projectId={props.projectId}
                            assetId={assetId}
                            sizeM={size}
                            name={name}
                            thumbnailUrl={
                              object
                                ? getDaemonUrl({ path: object.thumbUrl })
                                : getAssetUrl({
                                    projectId: props.projectId,
                                    assetId,
                                    fileName: "thumb.png",
                                  })
                            }
                          />
                        )}
                      {object && (
                        <div className="flex flex-wrap gap-x-2 gap-y-2">
                          <button
                            type="button"
                            onClick={() => props.onPlace({ ...object, name })}
                            className={buttonClass}
                          >
                            {t("editor.objects-panel.place-in-room")}
                          </button>
                          {!object.builtIn && items.length === 0 && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void setArchived({ object, archived: true })
                              }
                              className={`${buttonClass} text-danger`}
                            >
                              {t("editor.objects-panel.remove-from-catalog")}
                            </button>
                          )}
                        </div>
                      )}
                      {items.length > 1 && (
                        <div className="flex flex-col gap-y-1">
                          {items.map((placed, index) => (
                            <button
                              type="button"
                              key={placed.id}
                              aria-pressed={
                                (selected?.items ?? []).some(
                                  (item) => item.id === placed.id,
                                ) || selected?.item.id === placed.id
                              }
                              onClick={(event) =>
                                props.onSelect({
                                  itemId: placed.id,
                                  kind:
                                    event.shiftKey ||
                                    event.metaKey ||
                                    event.ctrlKey
                                      ? "toggle"
                                      : "replace",
                                })
                              }
                              className={`${buttonClass} aria-pressed:text-accent`}
                            >
                              {placed.name}{" "}
                              {t("editor.objects-panel.in-room-2")} {index + 1}
                            </button>
                          ))}
                        </div>
                      )}
                      {selected ? (
                        <>
                          {item && (
                            <ObjectSources
                              key={`${item.id}:${JSON.stringify(item.model)}`}
                              projectId={props.projectId}
                              itemId={item.id}
                            />
                          )}
                          <div className="flex flex-wrap gap-x-2 gap-y-2">
                            <button
                              type="button"
                              className={buttonClass}
                              onClick={props.onEdit}
                            >
                              {t("editor.objects-panel.advanced-settings")}
                            </button>
                            <button
                              type="button"
                              disabled={props.referenceLimitReached}
                              className={buttonClass}
                              onClick={props.onSendToChat}
                            >
                              {t("editor.objects-panel.send-to-chat")}
                            </button>
                          </div>
                          <InspectorBody {...selected} />
                        </>
                      ) : (
                        item && (
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={(event) =>
                              props.onSelect({
                                itemId: item.id,
                                kind:
                                  event.shiftKey ||
                                  event.metaKey ||
                                  event.ctrlKey
                                    ? "toggle"
                                    : "replace",
                              })
                            }
                          >
                            {t(
                              "editor.objects-panel.select-in-room-to-configure",
                            )}
                          </button>
                        )
                      )}
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
