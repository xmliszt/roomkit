/** Return the field value with `text` placed between `before` and `after`, joined by `separator` where `before` does not already end with whitespace and `after` does not already start with whitespace or closing punctuation, and the caret just after `text`. */
export function applyDictation(options: {
  before: string;
  after: string;
  text: string;
  separator: string;
}) {
  if (options.text === "") {
    return {
      value: options.before + options.after,
      caret: options.before.length,
    };
  }
  const lead =
    options.before === "" || /\s$/.test(options.before)
      ? ""
      : options.separator;
  const trail =
    options.after === "" || /^[\s.,!?;:)]/.test(options.after)
      ? ""
      : options.separator;
  const head = options.before + lead + options.text;
  return { value: head + trail + options.after, caret: head.length };
}
