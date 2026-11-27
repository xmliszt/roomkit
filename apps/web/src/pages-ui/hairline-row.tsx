import type { ReactNode } from "react";

type HairlineRowProps = {
  title: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
};

export function HairlineRow(props: HairlineRowProps) {
  return (
    <div className="hairline-row border-line border-b py-2">
      <div className="hairline-title flex min-w-0 flex-col">
        <span className="truncate">{props.title}</span>
        {props.status !== undefined && (
          <span className="truncate text-ink-dim">{props.status}</span>
        )}
      </div>
      <div className="hairline-action">{props.action}</div>
    </div>
  );
}
