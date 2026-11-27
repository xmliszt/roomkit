"use client";

import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { Box, Mic, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import type { MessageTranslator } from "../i18n/message-translator.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { FloatingPopover } from "../ui/floating-popover.tsx";
import type { AttachedPhoto } from "./attached-photo.ts";
import { composerTransition } from "./interface-motion.ts";
import { maxItemReferences } from "./max-item-references.ts";
import { ShortcutKeys } from "./shortcut-keys.tsx";
import type { useVoiceInput } from "./voice/use-voice-input.ts";
import type { VoiceInputError } from "./voice/voice-input-state.ts";

type ComposerProps = {
  docked: boolean;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  photos: AttachedPhoto[];
  items: Item[];
  referencedItems: Item[];
  onAddItem: (itemId: string) => void;
  onRemoveItem: (itemId: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemovePhoto: (id: string) => void;
  onSubmit: () => void;
  voice: ReturnType<typeof useVoiceInput>;
};

function getVoiceErrorMessage({
  error,
  t,
}: {
  error: VoiceInputError;
  t: MessageTranslator;
}) {
  switch (error) {
    case "permission-denied":
      return t("editor.composer.voice-permissionDenied");
    case "no-microphone":
      return t("editor.composer.voice-noMicrophone");
    case "network":
      return t("editor.composer.voice-network");
    case "no-speech":
      return t("editor.composer.voice-noSpeech");
    case "language-not-supported":
      return t("editor.composer.voice-languageNotSupported");
    case "failed":
      return t("editor.composer.voice-failed");
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

export function Composer(props: ComposerProps) {
  const t = useMessages();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isReducedMotion = useReducedMotion() ?? false;
  const childLayout = isReducedMotion ? false : "position";

  const listId = useId();
  const [mention, setMention] = useState<{
    start: number;
    end: number;
    query: string;
  }>();
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = props.items.filter(
    (item) =>
      !props.referencedItems.some((reference) => reference.id === item.id) &&
      item.name
        .toLocaleLowerCase()
        .includes(mention?.query.toLocaleLowerCase() ?? ""),
  );
  const pickerOpen =
    mention !== undefined && props.referencedItems.length < maxItemReferences;
  const activeItem = matches.at(Math.min(activeIndex, matches.length - 1));
  const listRef = useRef<HTMLDivElement>(null);
  const activeOptionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen || !activeItem) return;
    const list = listRef.current;
    const option = activeOptionRef.current;
    if (!list || !option) return;
    const scrollTop = list.scrollTop;
    option.scrollIntoView({ block: "nearest" });
    return () => {
      list.scrollTop = scrollTop;
    };
  }, [pickerOpen, activeItem]);
  function updateMention(input: HTMLInputElement) {
    const end = input.selectionStart ?? input.value.length;
    const match = /(?:^|\s)@([^@]*)$/.exec(input.value.slice(0, end));
    const next = match
      ? {
          start: end - (match.at(1)?.length ?? 0) - 1,
          end,
          query: match.at(1) ?? "",
        }
      : undefined;
    if (
      next?.start === mention?.start &&
      next?.end === mention?.end &&
      next?.query === mention?.query
    )
      return;
    setMention(next);
    setActiveIndex(0);
  }
  function chooseItem(itemId: string) {
    const input = props.inputRef.current;
    if (!input || !mention) return;
    props.voice.cancel();
    const start = mention.start;
    input.value = input.value.slice(0, start) + input.value.slice(mention.end);
    props.onAddItem(itemId);
    setMention(undefined);
    input.focus();
    input.setSelectionRange(start, start);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (
      pickerOpen &&
      ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") setMention(undefined);
      else if (event.key === "Enter") {
        if (activeItem) chooseItem(activeItem.id);
      } else
        setActiveIndex((current) =>
          matches.length
            ? (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                matches.length) %
              matches.length
            : 0,
        );
      return;
    }
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }
    if (event.currentTarget.value.trim() === "" && props.photos.length === 0) {
      return;
    }
    if (!props.busy) props.onSubmit();
  }

  const isVoiceDisabled =
    props.voice.state.kind === "unavailable" ||
    (props.voice.isPaused && props.voice.state.kind !== "listening");

  return (
    <motion.div
      layout={!isReducedMotion}
      {...(isReducedMotion ? {} : { layoutId: "composer" })}
      transition={composerTransition}
      data-chrome
      data-testid="composer"
      data-docked={props.docked}
      style={{ borderRadius: 2 }}
      className={
        props.docked
          ? "absolute right-4 bottom-4 z-panel flex h-11 w-[min(400px,calc(100%-32px))] items-center gap-x-2 border border-line bg-bg px-3 has-[input:focus-visible]:outline has-[input:focus-visible]:outline-accent has-[input:focus-visible]:outline-offset-1"
          : "absolute bottom-4 left-[calc(50%-min(240px,50%-16px))] z-panel flex h-9 w-[min(480px,calc(100%-32px))] items-center gap-x-2 border border-line bg-bg px-2.5 has-[input:focus-visible]:outline has-[input:focus-visible]:outline-accent has-[input:focus-visible]:outline-offset-1"
      }
    >
      {(props.photos.length > 0 ||
        props.referencedItems.length > 0 ||
        pickerOpen) && (
        <motion.div
          layout={childLayout}
          className="absolute bottom-[calc(100%+6px)] -left-px flex w-full flex-col gap-y-1 bg-bg p-1"
        >
          {pickerOpen && (
            <FloatingPopover placement="above">
              <div
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label={t("editor.composer.room-objects")}
                className="max-h-48 overflow-y-auto border border-line bg-bg"
              >
                {matches.length === 0 && (
                  <p className="px-2 py-1 text-ink-dim">
                    {t("editor.composer.no-matching-objects")}
                  </p>
                )}
                {matches.map((item, index) => (
                  <div
                    key={item.id}
                    ref={
                      item.id === activeItem?.id ? activeOptionRef : undefined
                    }
                    id={`${listId}-${item.id}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={item.id === activeItem?.id}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      chooseItem(item.id);
                    }}
                    onPointerMove={() => setActiveIndex(index)}
                    className="cursor-pointer px-2 py-1 aria-selected:bg-muted aria-selected:text-accent"
                  >
                    {item.name}
                  </div>
                ))}
              </div>
            </FloatingPopover>
          )}
          {props.referencedItems.length > 0 && (
            <div
              className="flex flex-wrap gap-x-1 gap-y-1"
              data-testid="referenced-objects"
            >
              {props.referencedItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={t("editor.composer.remove-reference-to-name", {
                    name: item.name,
                  })}
                  onClick={() => props.onRemoveItem(item.id)}
                  className="flex max-w-full items-center gap-x-1.5 rounded-panel border border-line px-2 py-1"
                >
                  <Box
                    aria-hidden="true"
                    className="size-3 shrink-0"
                    strokeWidth={1.5}
                  />
                  <span className="truncate">{item.name}</span>
                  <X
                    aria-hidden="true"
                    className="size-3 shrink-0"
                    strokeWidth={1.5}
                  />
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-x-1.5">
            {props.photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                title={t("editor.composer.remove-name", {
                  name: photo.file.name,
                })}
                aria-label={t("editor.composer.remove-name", {
                  name: photo.file.name,
                })}
                onClick={() => props.onRemovePhoto(photo.id)}
                className="relative size-7 rounded-panel border border-line-strong bg-center bg-cover"
                style={{ backgroundImage: `url("${photo.url}")` }}
              >
                <span className="absolute -top-1.5 -right-1.5 grid size-3 place-items-center border border-line-strong bg-bg text-[10px] text-ink-dim leading-none">
                  ×
                </span>
              </button>
            ))}
          </div>
        </motion.div>
      )}
      <motion.button
        layout={childLayout}
        type="button"
        title={t("editor.composer.attach-a-photo")}
        data-attach-photo
        aria-label={t("editor.composer.attach-a-photo")}
        onClick={() => fileInputRef.current?.click()}
        className="press grid size-6 flex-none place-items-center hover:text-accent"
      >
        <svg
          viewBox="0 0 16 16"
          className="size-4 fill-none stroke-current"
          aria-hidden="true"
        >
          <rect x="2" y="3.5" width="12" height="9" />
          <circle cx="5.6" cy="6.8" r="1.1" />
          <path d="M2 11l3.6-2.8 2.6 2 2.3-1.8L14 11" />
        </svg>
      </motion.button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.webp,.heic,.heif"
        multiple
        hidden
        onChange={(event) => {
          props.onAddFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
          props.inputRef.current?.focus();
        }}
      />
      <motion.input
        layout={childLayout}
        ref={props.inputRef}
        type="text"
        dir="auto"
        aria-label={t("editor.composer.message")}
        placeholder={t("editor.composer.describe-ask-or-drop-a-photo")}
        autoComplete="off"
        onKeyDown={handleKeyDown}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={pickerOpen ? listId : undefined}
        aria-activedescendant={
          pickerOpen && activeItem ? `${listId}-${activeItem.id}` : undefined
        }
        onChange={(event) => {
          props.voice.cancel();
          updateMention(event.currentTarget);
        }}
        onSelect={(event) => updateMention(event.currentTarget)}
        onBlur={() => setMention(undefined)}
        className="h-full min-w-0 flex-1 text-ellipsis bg-transparent focus-visible:outline-none placeholder:text-ink-dim"
      />
      <motion.button
        layout={childLayout}
        type="button"
        aria-label={t("editor.composer.voice-input")}
        aria-keyshortcuts={
          props.voice.state.kind === "listening" ? "Escape" : "M"
        }
        aria-pressed={props.voice.state.kind === "listening"}
        aria-disabled={isVoiceDisabled}
        title={(() => {
          const state = props.voice.state;
          switch (state.kind) {
            case "unavailable":
              return t("editor.composer.voice-browser");
            case "listening":
              return t("editor.composer.voice-stop");
            case "idle":
            case "error":
              return props.voice.isPaused
                ? t("editor.composer.voice-wait")
                : t("editor.composer.voice-start");
            default: {
              const unreachable: never = state;
              return unreachable;
            }
          }
        })()}
        onClick={() => {
          if (!isVoiceDisabled) props.voice.toggle();
        }}
        className="press relative grid size-6 flex-none place-items-center hover:text-accent aria-disabled:cursor-not-allowed aria-disabled:text-ink-dim aria-disabled:opacity-40 aria-disabled:hover:text-ink-dim aria-pressed:text-accent"
      >
        {props.voice.state.kind === "listening" && (
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-ping border border-accent motion-reduce:animate-none"
          />
        )}
        <Mic aria-hidden="true" className="size-4" strokeWidth={1.5} />
      </motion.button>
      <motion.button
        type="button"
        aria-label={t("editor.composer.send")}
        disabled={props.busy}
        onClick={props.onSubmit}
        layout={childLayout}
        className="flex items-center disabled:text-ink-dim [&>kbd]:text-inherit"
      >
        <ShortcutKeys keys={["enter"]} />
      </motion.button>
      {props.voice.state.kind === "error" && (
        <p
          role="alert"
          className="absolute top-[calc(100%+1px)] left-0 w-full truncate text-[11px] text-danger leading-[14px]"
        >
          {getVoiceErrorMessage({ error: props.voice.state.error, t })}
        </p>
      )}
    </motion.div>
  );
}
