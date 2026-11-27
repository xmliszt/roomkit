import type { ReactNode } from "react";

type PageColumnProps = { title: string; children: ReactNode };

export function PageColumn(props: PageColumnProps) {
  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-col gap-y-10 px-4 py-16">
      <h1 className="type-page-title">{props.title}</h1>
      {props.children}
    </main>
  );
}
