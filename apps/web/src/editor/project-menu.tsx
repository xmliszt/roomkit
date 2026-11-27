import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { FloatingPopover } from "../ui/floating-popover.tsx";
import { panelEnter, panelExit } from "./interface-motion.ts";

type ProjectMenuProps = {
  name: string;
  projectId: string;
  onRename: (name: string) => Promise<string | undefined>;
  onExport: () => void;
  onImport: (archive: File) => void;
};

export function ProjectMenu(props: ProjectMenuProps) {
  const t = useMessages();
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isRenaming = draftName !== undefined;

  useEffect(() => {
    if (isRenaming) nameInputRef.current?.focus();
  }, [isRenaming]);

  async function submitRename() {
    const trimmed = draftName?.trim() ?? "";
    if (trimmed === "" || trimmed === props.name) {
      setDraftName(undefined);
      return;
    }
    setIsBusy(true);
    const failure = await props.onRename(trimmed);
    setIsBusy(false);
    setError(failure);
    if (failure === undefined) setDraftName(undefined);
  }

  const itemClass =
    "flex h-7 w-full items-center rounded-panel px-1.5 text-left hover:bg-accent-soft";

  return (
    <FloatingPopover placement="below" width={240}>
      <motion.div
        data-editor-popover
        role="menu"
        aria-label={t("editor.project-menu.project")}
        data-chrome
        initial={{ opacity: 0, scale: 0.95, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: panelEnter }}
        exit={{ opacity: 0, scale: 0.95, y: -4, transition: panelExit }}
        style={{ transformOrigin: "left top" }}
        className="panel relative w-full flex flex-col gap-y-0.5 p-1.5"
      >
        {draftName === undefined ? (
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setError(undefined);
              setDraftName(props.name);
            }}
          >
            {t("editor.project-menu.rename")}
          </button>
        ) : (
          <form
            className="flex h-7 items-center"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename();
            }}
          >
            <input
              dir="auto"
              ref={nameInputRef}
              aria-label={t("editor.project-menu.project-name")}
              value={draftName}
              disabled={isBusy}
              onChange={(event) => setDraftName(event.currentTarget.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setDraftName(undefined);
                  setError(undefined);
                }
              }}
              className="h-7 w-full rounded-panel border border-accent bg-bg px-1.5 outline-none"
            />
          </form>
        )}
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={props.onExport}
        >
          {t("editor.project-menu.export-iplan")}
        </button>
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => fileInputRef.current?.click()}
        >
          {t("editor.project-menu.import-iplan")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".iplan"
          aria-label={t("editor.project-menu.import-iplan-file")}
          className="hidden"
          onChange={(event) => {
            const archive = event.currentTarget.files?.item(0);
            event.currentTarget.value = "";
            if (archive !== null && archive !== undefined)
              props.onImport(archive);
          }}
        />
        <Link
          href={`/projects/${props.projectId}/capture`}
          role="menuitem"
          className={itemClass}
        >
          {t("editor.project-menu.capture-photos")}
        </Link>
        <hr className="my-1 border-line" />
        <Link href="/" role="menuitem" className={itemClass}>
          {t("editor.project-menu.back-to-projects")}
        </Link>
        {error !== undefined && (
          <p role="alert" className="px-1.5 pt-1 text-danger">
            {error}
          </p>
        )}
      </motion.div>
    </FloatingPopover>
  );
}
