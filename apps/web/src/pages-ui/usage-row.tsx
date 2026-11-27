import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";

type UsageRowProps = { title: string; percent: number; resetsAt: string };

export function UsageRow(props: UsageRowProps) {
  const t = useMessages();
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-y-1.5 border-line border-b py-3">
      <div className="usage-row">
        <span className="usage-title">{props.title}</span>
        <span className="usage-percent tabular-nums">
          {new Intl.NumberFormat(locale, {
            style: "percent",
            maximumFractionDigits: 1,
          }).format(props.percent / 100)}
        </span>
        <span className="usage-reset text-ink-dim tabular-nums">
          {t("pages-ui.usage-row.resets")} {props.resetsAt}
        </span>
      </div>
      <div className="h-1.5 rounded-panel border border-line">
        <div className="h-full bg-ink" style={{ width: `${props.percent}%` }} />
      </div>
    </div>
  );
}
