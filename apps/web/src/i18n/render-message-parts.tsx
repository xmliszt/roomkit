import { Fragment, type ReactNode } from "react";

export function renderMessageParts(options: {
  message: string;
  parts: { [name: string]: ReactNode };
}) {
  return options.message
    .split(/\{(\w+)\}/g)
    .map((part, index) =>
      index % 2 === 0 ? (
        part
      ) : (
        <Fragment key={part}>{options.parts[part] ?? `{${part}}`}</Fragment>
      ),
    );
}
