export function parseTomlValue(source) {
  let offset = 0;
  function whitespace() {
    while (/\s/.test(source.at(offset) ?? "") && offset < source.length)
      offset++;
  }
  function read() {
    whitespace();
    const first = source.at(offset);
    if (first === '"') {
      const start = offset++;
      while (offset < source.length) {
        const character = source.at(offset++);
        if (character === "\\") offset++;
        else if (character === '"')
          return JSON.parse(source.slice(start, offset));
      }
      throw new Error("Unterminated TOML string");
    }
    if (first === "{" || first === "[") {
      offset++;
      const object = {};
      const array = [];
      const end = first === "{" ? "}" : "]";
      whitespace();
      while (source.at(offset) !== end) {
        if (offset >= source.length) throw new Error("Unterminated TOML value");
        if (first === "{") {
          const key = source.at(offset) === '"' ? read() : bare();
          whitespace();
          if (source.at(offset++) !== "=")
            throw new Error("Expected TOML equals");
          Object.defineProperty(object, key, {
            value: read(),
            enumerable: true,
            configurable: true,
            writable: true,
          });
        } else array.push(read());
        whitespace();
        if (source.at(offset) === ",") {
          offset++;
          whitespace();
        } else if (source.at(offset) !== end)
          throw new Error("Expected TOML separator");
      }
      offset++;
      return first === "{" ? object : array;
    }
    const value = bare();
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    throw new Error(`Unsupported TOML value: ${value}`);
  }
  function bare() {
    const start = offset;
    while (offset < source.length && !/[\s,\]}=]/.test(source.at(offset)))
      offset++;
    if (start === offset) throw new Error("Expected TOML value");
    return source.slice(start, offset);
  }
  const value = read();
  whitespace();
  if (offset !== source.length) throw new Error("Trailing TOML input");
  return value;
}
