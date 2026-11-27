import { describe, expect, it } from "vitest";
import { getWordSeparator } from "./get-word-separator.ts";

describe("getWordSeparator", () => {
  it("returns no space for languages written without spaces", () => {
    expect(getWordSeparator("zh-CN")).toBe("");
    expect(getWordSeparator("ja")).toBe("");
    expect(getWordSeparator("th-TH")).toBe("");
  });

  it("returns a space otherwise", () => {
    expect(getWordSeparator("en-GB")).toBe(" ");
    expect(getWordSeparator("ko-KR")).toBe(" ");
    expect(getWordSeparator("")).toBe(" ");
  });
});
