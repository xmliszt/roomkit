import {
  type ItemSourcesResult,
  ItemSourcesResultSchema,
} from "@planner/shared/src/protocol/item-sources-result-schema.ts";
import Image from "next/image";
import { useEffect, useState } from "react";
import { getDaemonUrl } from "../../daemon-http/get-daemon-url.ts";
import { useMessages } from "../../i18n/use-messages.ts";
import { usePlannerSession } from "../../planner/use-planner-session.ts";
import { Modal } from "../../ui/modal.tsx";

type Source = ItemSourcesResult["items"][number]["photos"][number];
type ObjectSourcesProps = {
  projectId: string;
  itemId: string;
};

export function ObjectSources(props: ObjectSourcesProps) {
  const t = useMessages();
  const session = usePlannerSession();
  const [sources, setSources] = useState<Source[]>();
  const [error, setError] = useState<string>();
  const [opened, setOpened] = useState<Source>();
  useEffect(() => {
    let cancelled = false;
    setSources(undefined);
    setError(undefined);
    async function read() {
      try {
        const reply = await session.command({
          type: "item.sources",
          projectId: props.projectId,
          itemId: props.itemId,
        });
        if (!reply.ok) throw new Error(reply.error);
        const result = ItemSourcesResultSchema.parse(reply.result);
        if (!cancelled) setSources(result.items.at(0)?.photos ?? []);
      } catch (caught) {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
    void read();
    return () => {
      cancelled = true;
    };
  }, [session, props.projectId, props.itemId]);
  function photoUrl(source: Source) {
    return getDaemonUrl({
      path:
        source.kind === "web"
          ? source.imageUrl
          : `/projects/${props.projectId}/photos/${source.photoId}`,
    });
  }
  return (
    <section
      aria-label={t("editor.object-sources.source-photos")}
      className="flex flex-col gap-y-2"
    >
      <h3 className="type-label">{t("editor.object-sources.source-photos")}</h3>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : sources === undefined ? (
        <p className="text-ink-dim">
          {t("editor.object-sources.loading-references")}
        </p>
      ) : sources.length === 0 ? (
        <p className="text-ink-dim">
          {t("editor.object-sources.no-source-photos")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-x-2 gap-y-2">
          {sources.map((source, index) => (
            <button
              key={`${index}:${source.kind === "photo" ? source.photoId : source.imageUrl}`}
              type="button"
              onClick={() => setOpened(source)}
              aria-label={t(
                source.isBest
                  ? "editor.object-sources.open-best-source-photo"
                  : "editor.object-sources.open-source-photo",
                { number: index + 1 },
              )}
              className="flex flex-col gap-y-1 text-left"
            >
              <Image
                unoptimized
                width={96}
                height={96}
                crossOrigin="anonymous"
                src={
                  source.kind === "photo" && source.cropUrl
                    ? getDaemonUrl({ path: source.cropUrl })
                    : photoUrl(source)
                }
                alt={t("editor.object-sources.source-view-number", {
                  number: index + 1,
                })}
                className="size-20 border border-line object-contain"
              />
              <span className="text-[11px] text-ink-dim">
                {source.isBest
                  ? t("editor.object-sources.best-view")
                  : t("editor.object-sources.view-number", {
                      number: index + 1,
                    })}
              </span>
            </button>
          ))}
        </div>
      )}
      {opened && (
        <Modal
          title={t("editor.object-sources.source-photo")}
          wide
          onClose={() => setOpened(undefined)}
        >
          <div className="flex flex-col items-center gap-y-2 p-3">
            <div className="relative inline-flex">
              <Image
                unoptimized
                width={1568}
                height={1568}
                crossOrigin="anonymous"
                src={photoUrl(opened)}
                alt={t("editor.object-sources.original-reference-photo")}
                className="h-auto w-auto max-h-[65dvh] max-w-full object-contain"
              />
              {opened.kind === "photo" && opened.box && (
                <span
                  data-testid="source-box"
                  className="pointer-events-none absolute border-2 border-accent"
                  style={{
                    left: `${opened.box[0] * 100}%`,
                    top: `${opened.box[1] * 100}%`,
                    width: `${(opened.box[2] - opened.box[0]) * 100}%`,
                    height: `${(opened.box[3] - opened.box[1]) * 100}%`,
                  }}
                />
              )}
            </div>
            {opened.kind === "web" && (
              <a
                href={opened.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {t("editor.object-sources.open-source-page")}
              </a>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
