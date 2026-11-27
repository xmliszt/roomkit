import { expect, test } from "vitest";
import { formatToolPayload } from "./format-tool-payload.ts";

test("parses a JSON string and JSON nested inside its strings", () => {
  const nested = JSON.stringify({
    content: [{ type: "text", text: JSON.stringify({ revision: 3 }) }],
  });
  expect(formatToolPayload(nested)).toBe(
    JSON.stringify(
      { content: [{ type: "text", text: { revision: 3 } }] },
      null,
      2,
    ),
  );
});

test("indents JSON that was cut off and marks it", () => {
  expect(formatToolPayload('{"revision":3,"scene":{"items":[{"id":"a b"')).toBe(
    '{\n  "revision": 3,\n  "scene": {\n    "items": [\n      {\n        "id": "a b"\n… (cut off)',
  );
});

test("leaves plain text unchanged", () => {
  expect(formatToolPayload("Completed")).toBe("Completed");
});
