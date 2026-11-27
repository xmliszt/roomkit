"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { useMessages } from "../i18n/use-messages.ts";

type ModalProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  side?: boolean;
  layer?: "popover" | "modal";
};

export function Modal(props: ModalProps) {
  const t = useMessages();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={props.title}
      onCancel={props.onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`${props.layer === "popover" ? "z-popover" : "z-modal"} ${props.side ? "my-0 mr-0 ml-auto h-dvh max-h-dvh" : "m-auto max-h-[85dvh]"} overflow-y-auto rounded-panel border border-line-strong bg-bg p-0 text-ink backdrop:bg-ink/20 ${props.wide ? "w-[min(900px,90vw)]" : "w-[min(480px,90vw)]"}`}
    >
      <div className="flex items-center gap-x-3 border-line border-b px-3 py-2">
        <h2 className="type-label flex-1">{props.title}</h2>
        <button
          type="button"
          onClick={props.onClose}
          aria-label={t("ui.modal.close-title", { title: props.title })}
          className="size-7 text-ink-dim hover:text-ink"
        >
          ×
        </button>
      </div>
      {props.children}
    </dialog>
  );
}
