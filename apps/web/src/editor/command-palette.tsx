"use client";

import { useId, useState } from "react";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { Modal } from "../ui/modal.tsx";

type CommandPaletteProps = {
  actions: { id: string; label: string; run: () => void; disabled?: boolean }[];
  onClose: () => void;
};

export function CommandPalette(props: CommandPaletteProps) {
  const t = useMessages();
  const locale = useLocale();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const filtered = props.actions.filter((action) =>
    action.label
      .toLocaleLowerCase(locale)
      .includes(query.toLocaleLowerCase(locale)),
  );
  const active = filtered.at(selected);
  function run(id: string) {
    const action = filtered.find((entry) => entry.id === id);
    if (!action || action.disabled) return;
    props.onClose();
    action.run();
  }
  return (
    <Modal
      layer="popover"
      title={t("editor.command-palette.commands")}
      onClose={props.onClose}
    >
      <div className="p-2">
        <input
          aria-label={t("editor.command-palette.search-commands")}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
          aria-autocomplete="list"
          value={query}
          placeholder={t("editor.command-palette.search-commands-2")}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const index =
                (selected +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  filtered.length) %
                Math.max(1, filtered.length);
              setSelected(index);
              document
                .getElementById(`${listId}-${filtered.at(index)?.id}`)
                ?.scrollIntoView({ block: "nearest" });
            } else if (
              event.key === "Enter" &&
              !event.nativeEvent.isComposing &&
              active
            ) {
              event.preventDefault();
              run(active.id);
            }
          }}
          className="h-9 w-full border border-line bg-bg px-2"
        />
        <div
          id={listId}
          role="listbox"
          aria-label={t("editor.command-palette.commands")}
          className="flex max-h-80 flex-col overflow-y-auto pt-2"
        >
          {filtered.map((action, index) => (
            <div
              key={action.id}
              id={`${listId}-${action.id}`}
              role="option"
              tabIndex={-1}
              aria-selected={selected === index}
              aria-disabled={action.disabled}
              className="aria-selected:bg-muted"
            >
              <button
                type="button"
                disabled={action.disabled}
                tabIndex={-1}
                onPointerMove={() => setSelected(index)}
                onClick={() => run(action.id)}
                className="min-h-8 w-full px-2 text-left disabled:opacity-50"
              >
                {action.label}
              </button>
            </div>
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="px-2 py-3 text-ink-dim">
            {t("editor.command-palette.no-matching-commands")}
          </p>
        )}
      </div>
    </Modal>
  );
}
