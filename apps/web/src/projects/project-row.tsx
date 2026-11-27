"use client";

import type { ProjectSummary } from "@planner/shared/src/project/project-schema.ts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { HairlineRow } from "../pages-ui/hairline-row.tsx";
import { RowButton } from "../pages-ui/row-button.tsx";
import { usePlannerSession } from "../planner/use-planner-session.ts";

type ProjectRowProps = { project: ProjectSummary };

type RowMode =
  | { kind: "view" }
  | { kind: "rename"; name: string }
  | { kind: "confirm-remove" };

export function ProjectRow(props: ProjectRowProps) {
  const t = useMessages();
  const session = usePlannerSession();
  const [mode, setMode] = useState<RowMode>({ kind: "view" });
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isRenaming = mode.kind === "rename";

  useEffect(() => {
    if (isRenaming) nameInputRef.current?.focus();
  }, [isRenaming]);

  async function send(
    request:
      | { type: "project.rename"; projectId: string; name: string }
      | { type: "project.remove"; projectId: string },
  ) {
    setIsBusy(true);
    setError(undefined);
    try {
      const ack = await session.command(request);
      if (ack.ok) {
        setMode({ kind: "view" });
      } else {
        setError(ack.error);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsBusy(false);
    }
  }

  function handleRenameSubmit(name: string) {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === props.project.name) {
      setMode({ kind: "view" });
      return;
    }
    void send({
      type: "project.rename",
      projectId: props.project.id,
      name: trimmed,
    });
  }

  switch (mode.kind) {
    case "view":
      return (
        <HairlineRow
          title={
            <Link
              href={`/projects/${props.project.id}`}
              className="hover:text-accent"
            >
              <bdi>{props.project.name}</bdi>
            </Link>
          }
          status={error && t("projects.changeFailed", { detail: error })}
          action={
            <div className="flex gap-x-2">
              <Link
                href={`/projects/${props.project.id}`}
                aria-label={t("projects.openNamed", {
                  name: props.project.name,
                })}
                className="press h-7 flex-none whitespace-nowrap rounded-panel border border-line px-2.5 leading-[26px] hover:border-line-strong"
              >
                {t("projects.open")}
              </Link>
              <RowButton
                label={t("projects.renameNamed", { name: props.project.name })}
                onClick={() => {
                  setError(undefined);
                  setMode({ kind: "rename", name: props.project.name });
                }}
              >
                {t("projects.rename")}
              </RowButton>
              <RowButton
                label={t("projects.removeNamed", { name: props.project.name })}
                onClick={() => {
                  setError(undefined);
                  setMode({ kind: "confirm-remove" });
                }}
              >
                {t("projects.remove")}
              </RowButton>
            </div>
          }
        />
      );
    case "rename":
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleRenameSubmit(mode.name);
          }}
        >
          <HairlineRow
            title={
              <input
                dir="auto"
                aria-label={t("projects.projectName")}
                ref={nameInputRef}
                value={mode.name}
                onChange={(event) =>
                  setMode({ kind: "rename", name: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") setMode({ kind: "view" });
                }}
                className="h-7 w-full rounded-panel border border-line-strong bg-transparent px-2"
              />
            }
            status={error && t("projects.changeFailed", { detail: error })}
            action={
              <div className="flex gap-x-2">
                <RowButton type="submit" disabled={isBusy}>
                  {t("projects.save")}
                </RowButton>
                <RowButton onClick={() => setMode({ kind: "view" })}>
                  {t("projects.cancel")}
                </RowButton>
              </div>
            }
          />
        </form>
      );
    case "confirm-remove":
      return (
        <HairlineRow
          title={<bdi>{props.project.name}</bdi>}
          status={
            error === undefined
              ? t("projects.removeConfirmation")
              : t("projects.changeFailed", { detail: error })
          }
          action={
            <div className="flex gap-x-2">
              <RowButton
                danger
                disabled={isBusy}
                onClick={() =>
                  void send({
                    type: "project.remove",
                    projectId: props.project.id,
                  })
                }
              >
                {t("projects.confirmRemove")}
              </RowButton>
              <RowButton onClick={() => setMode({ kind: "view" })}>
                {t("projects.cancel")}
              </RowButton>
            </div>
          }
        />
      );
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}
