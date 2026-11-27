"use client";

import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAppLanguage } from "../i18n/use-app-language.ts";
import { RowButton } from "../pages-ui/row-button.tsx";
import { usePlannerSession } from "../planner/use-planner-session.ts";

const fields = [
  { key: "widthM", label: "projects.width", error: "projects.enterWidth" },
  { key: "depthM", label: "projects.depth", error: "projects.enterDepth" },
  {
    key: "ceilingHeightM",
    label: "projects.ceilingHeight",
    error: "projects.enterCeilingHeight",
  },
] as const;

type Sizes = { widthM: string; depthM: string; ceilingHeightM?: string };
type ProjectFormError =
  | {
      kind: "validation";
      key: (typeof fields)[number]["error"] | "projects.nameRequired";
    }
  | { kind: "request"; detail: string };

export function NewProjectForm() {
  const { locale, t } = useAppLanguage();
  const decimal = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
  const session = usePlannerSession();
  const router = useRouter();
  const [draftName, setName] = useState<string>();
  const name = draftName ?? t("projects.defaultName");
  const [sizes, setSizes] = useState<Sizes>({
    widthM: "",
    depthM: "",
  });
  const [error, setError] = useState<ProjectFormError>();
  const [isBusy, setIsBusy] = useState(false);

  async function handleSubmit(destination: "editor" | "capture" = "editor") {
    const room = {
      widthM:
        destination === "capture" ? 4 : Number(sizes.widthM.replace(",", ".")),
      depthM:
        destination === "capture" ? 5 : Number(sizes.depthM.replace(",", ".")),
      ceilingHeightM:
        destination === "capture"
          ? 2.6
          : sizes.ceilingHeightM === undefined
            ? 2.6
            : Number(sizes.ceilingHeightM.replace(",", ".")),
    };
    const invalid = fields.find(
      (field) => !(Number.isFinite(room[field.key]) && room[field.key] > 0),
    );
    if (invalid !== undefined || name.trim() === "") {
      setError({
        kind: "validation",
        key: invalid?.error ?? "projects.nameRequired",
      });
      return;
    }
    setIsBusy(true);
    setError(undefined);
    try {
      const ack = await session.command({
        type: "project.create",
        name: name.trim(),
        room,
      });
      if (!ack.ok) {
        setError({ kind: "request", detail: ack.error });
        return;
      }
      router.push(
        `/projects/${ProjectSchema.parse(ack.result).id}${destination === "capture" ? "/capture" : ""}`,
      );
    } catch (caught) {
      setError({
        kind: "request",
        detail: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-y-3 border-line border-b py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <label className="flex flex-col gap-y-1">
        <span className="type-label">{t("projects.name")}</span>
        <input
          dir="auto"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-7 rounded-panel border border-line bg-transparent px-2 hover:border-line-strong"
        />
      </label>
      <div className="grid grid-cols-3 items-end gap-x-3 gap-y-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
        {fields.map((field) => (
          <label
            key={field.key}
            className="flex min-w-0 flex-1 flex-col gap-y-1"
          >
            <span className="type-label">{t(field.label)}</span>
            <span className="flex h-7 items-center rounded-panel border border-line px-2 hover:border-line-strong focus-within:border-line-strong">
              <input
                inputMode="decimal"
                placeholder={decimal.format(0)}
                value={sizes[field.key] ?? decimal.format(2.6)}
                onChange={(event) =>
                  setSizes((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
                className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
              />
              <span className="text-ink-dim">m</span>
            </span>
          </label>
        ))}
        <div className="col-span-full sm:col-span-1">
          <RowButton type="submit" disabled={isBusy}>
            {t("projects.create")}
          </RowButton>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <RowButton
          disabled={isBusy}
          onClick={() => {
            void handleSubmit("capture");
          }}
        >
          {t("projects.startFromPhotos")}
        </RowButton>
        <span className="text-ink-dim">{t("projects.photoSizeHint")}</span>
      </div>
      {error !== undefined && (
        <p className="text-danger">
          {error.kind === "validation"
            ? t(error.key)
            : t("projects.createFailed", { detail: error.detail })}
        </p>
      )}
    </form>
  );
}
