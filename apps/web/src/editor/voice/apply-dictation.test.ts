import { describe, expect, it } from "vitest";
import { applyDictation } from "./apply-dictation.ts";

describe("applyDictation", () => {
  it("fills an empty field", () => {
    expect(
      applyDictation({ before: "", after: "", text: "a lamp", separator: " " }),
    ).toEqual({
      value: "a lamp",
      caret: 6,
    });
  });

  it("appends after typed text with one space", () => {
    expect(
      applyDictation({
        before: "add",
        after: "",
        text: "a lamp",
        separator: " ",
      }),
    ).toEqual({ value: "add a lamp", caret: 10 });
    expect(
      applyDictation({
        before: "add ",
        after: "",
        text: "a lamp",
        separator: " ",
      }),
    ).toEqual({ value: "add a lamp", caret: 10 });
  });

  it("inserts at the caret and keeps the text after it", () => {
    expect(
      applyDictation({
        before: "put",
        after: "by the window",
        text: "a green sofa",
        separator: " ",
      }),
    ).toEqual({ value: "put a green sofa by the window", caret: 16 });
    expect(
      applyDictation({
        before: "put ",
        after: " here",
        text: "it",
        separator: " ",
      }),
    ).toEqual({ value: "put it here", caret: 6 });
  });

  it("adds no space before punctuation after the caret", () => {
    expect(
      applyDictation({
        before: "a lamp",
        after: ", please",
        text: "by the bed",
        separator: " ",
      }),
    ).toEqual({ value: "a lamp by the bed, please", caret: 17 });
  });

  it("joins without spaces for languages written without them", () => {
    expect(
      applyDictation({
        before: "放",
        after: "",
        text: "一个沙发",
        separator: "",
      }),
    ).toEqual({ value: "放一个沙发", caret: 5 });
  });

  it("leaves the field as it was while nothing is heard", () => {
    expect(
      applyDictation({
        before: "put",
        after: " here",
        text: "",
        separator: " ",
      }),
    ).toEqual({ value: "put here", caret: 3 });
  });
});
