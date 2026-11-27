import { useMessages } from "../i18n/use-messages.ts";
export function DropFrame() {
  const t = useMessages();
  return (
    <div className="pointer-events-none absolute inset-3 z-popover grid place-items-center border border-accent border-dashed bg-accent-soft">
      <span className="type-label bg-bg px-2 py-0.5 text-accent">
        {t("editor.drop-frame.drop-photo-to-attach")}
      </span>
    </div>
  );
}
