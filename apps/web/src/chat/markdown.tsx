import { Fragment } from "react";

type MarkdownProps = { text: string };

function inline(text: string) {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g)
    .map((part, index) => {
      const key = `${index}:${part}`;
      if (/^`[^`]+`$/.test(part))
        return (
          <code dir="ltr" key={key} className="bg-muted px-1">
            {part.slice(1, -1)}
          </code>
        );
      if (/^\*\*[^*]+\*\*$/.test(part))
        return (
          <strong key={key} className="font-medium">
            {part.slice(2, -2)}
          </strong>
        );
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
      if (link)
        return (
          <a
            key={key}
            href={link.at(2)}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {link.at(1)}
          </a>
        );
      return <Fragment key={key}>{part}</Fragment>;
    });
}

function paragraphs(text: string) {
  function kind(line: string) {
    if (/^\s*[-*+]\s/.test(line)) return "unordered";
    if (/^\s*\d+\.\s/.test(line)) return "ordered";
    if (/^#{1,6}\s/.test(line)) return "heading";
    return "paragraph";
  }
  return text
    .split(/\n\s*\n/)
    .filter(Boolean)
    .flatMap((section) =>
      section
        .trim()
        .split("\n")
        .reduce<string[]>((blocks, line) => {
          const previous = blocks.at(-1);
          if (
            previous === undefined ||
            kind(line) === "heading" ||
            kind(previous) !== kind(line)
          )
            blocks.push(line);
          else blocks.splice(-1, 1, `${previous}\n${line}`);
          return blocks;
        }, []),
    );
}

function cells(line: string) {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function Markdown(props: MarkdownProps) {
  const sections = props.text.split(/(```[\s\S]*?(?:```|$))/g);
  return (
    <div className="flex min-w-0 flex-col gap-y-2 break-words">
      {sections.map((section, sectionIndex) => {
        if (!section) return null;
        if (section.startsWith("```"))
          return (
            <pre
              dir="ltr"
              key={section}
              className="overflow-x-auto border border-line p-2 text-[11px]"
            >
              <code>
                {section.replace(/^```[^\n]*\n?/, "").replace(/```$/, "")}
              </code>
            </pre>
          );
        return paragraphs(section).map((paragraph, paragraphIndex) => {
          const key = `${sectionIndex}:${paragraphIndex}`;
          const lines = paragraph.trim().split("\n");
          const first = lines.at(0) ?? "";
          if (
            lines.length > 1 &&
            /^\|?\s*:?-+/.test(lines.at(1) ?? "") &&
            first.includes("|")
          )
            return (
              <div key={key} className="overflow-x-auto">
                <table dir="auto" className="w-full border-collapse text-start">
                  <thead>
                    <tr>
                      {cells(first).map((cell, index) => (
                        <th
                          key={`${index}:${cell}`}
                          className="border border-line px-2 py-1 font-medium"
                        >
                          {inline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.slice(2).map((line, row) => (
                      <tr key={`${row}:${line}`}>
                        {cells(line).map((cell, col) => (
                          <td
                            key={`${col}:${cell}`}
                            className="border border-line px-2 py-1"
                          >
                            {inline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          if (lines.every((line) => /^\s*[-*+]\s/.test(line)))
            return (
              <ul key={key} className="list-inside list-disc">
                {lines.map((line, index) => (
                  <li key={`${index}:${line}`} dir="auto" className="ps-4">
                    {inline(line.replace(/^\s*[-*+]\s/, ""))}
                  </li>
                ))}
              </ul>
            );
          if (lines.every((line) => /^\s*\d+\.\s/.test(line)))
            return (
              <ol key={key} className="list-inside list-decimal">
                {lines.map((line, index) => (
                  <li key={`${index}:${line}`} dir="auto" className="ps-4">
                    {inline(line.replace(/^\s*\d+\.\s/, ""))}
                  </li>
                ))}
              </ol>
            );
          return (
            <p
              dir="auto"
              key={key}
              className={
                /^#{1,6}\s/.test(first)
                  ? "whitespace-pre-wrap font-medium"
                  : "whitespace-pre-wrap"
              }
            >
              {inline(paragraph.replace(/^#{1,6}\s/gm, ""))}
            </p>
          );
        });
      })}
    </div>
  );
}
