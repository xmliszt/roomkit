import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Markdown } from "./markdown.tsx";

test("incomplete streamed delimiters preserve every received character", () => {
  for (const text of ["**Oak", "`width", "**important", "`partial"]) {
    const html = renderToStaticMarkup(createElement(Markdown, { text }));
    expect(html).toContain(text);
    expect(html).not.toContain("<strong");
    expect(html).not.toContain("<code");
  }
});

test("a list can interrupt a paragraph and end before the next paragraph", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: "Recommendations:\n- Oak\n- Walnut\nChoose a finish.\n1. Measure\n2. Place",
    }),
  );
  expect(html).toContain("Recommendations:</p><ul");
  expect(html).toMatch(/<li[^>]*>Oak<\/li><li[^>]*>Walnut<\/li><\/ul><p/);
  expect(html).toContain("Choose a finish.</p><ol");
  expect(html).toMatch(/<li[^>]*>Measure<\/li><li[^>]*>Place<\/li>/);
});
