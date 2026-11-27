import type { ReactNode } from "react";

type RowSectionProps = {
  sectionId?: string;
  title: string;
  children: ReactNode;
};

export function RowSection(props: RowSectionProps) {
  return (
    <section id={props.sectionId} className="flex flex-col gap-y-2">
      <h2 className="type-panel-title">{props.title}</h2>
      <div className="flex flex-col border-line border-t">{props.children}</div>
    </section>
  );
}
