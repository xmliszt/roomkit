/** Return `value` as indented, readable text: parses JSON strings (also JSON nested in strings) and indents JSON that was cut off mid-way, leaving other text unchanged. */
export function formatToolPayload(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") return JSON.stringify(unwrap(value), null, 2);
  const trimmed = value.trim();
  if (!/^[[{]/.test(trimmed)) return value;
  try {
    return JSON.stringify(unwrap(JSON.parse(trimmed)), null, 2);
  } catch {
    return `${indentPartialJson(trimmed)}\n… (cut off)`;
  }
}

function unwrap(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[[{]/.test(trimmed)) return value;
    try {
      return unwrap(JSON.parse(trimmed));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(unwrap);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, unwrap(entry)]),
    );
  return value;
}

function indentPartialJson(text: string) {
  const state = { depth: 0, inString: false, isEscaped: false };
  const pad = () => `\n${"  ".repeat(state.depth)}`;
  return [...text]
    .map((character) => {
      if (state.inString) {
        if (state.isEscaped) state.isEscaped = false;
        else if (character === "\\") state.isEscaped = true;
        else if (character === '"') state.inString = false;
        return character;
      }
      switch (character) {
        case '"':
          state.inString = true;
          return character;
        case "{":
        case "[":
          state.depth++;
          return character + pad();
        case "}":
        case "]":
          state.depth = Math.max(0, state.depth - 1);
          return pad() + character;
        case ",":
          return character + pad();
        case ":":
          return ": ";
        default:
          return /\s/.test(character) ? "" : character;
      }
    })
    .join("");
}
