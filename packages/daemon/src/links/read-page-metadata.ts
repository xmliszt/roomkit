const MAX_HEAD_CHARS = 64 * 1024;

const ENTITIES: { [name: string]: string } = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string) {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, code: string) => {
      if (!code.startsWith("#")) return ENTITIES[code.toLowerCase()] ?? match;
      const codePoint = /^#x/i.test(code)
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    },
  );
}

function readAttributes(tag: string) {
  return Object.fromEntries(
    [
      ...tag.matchAll(
        /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
      ),
    ].map((match) => [
      (match[1] ?? "").toLowerCase(),
      decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""),
    ]),
  );
}

function clean(text: string | undefined) {
  const value = text?.replace(/\s+/g, " ").trim();
  return value ? value.slice(0, 300) : undefined;
}

/** Read the title and the OG image URL from the first 64 kB of an HTML page's head; the image URL is resolved against `pageUrl`. */
export function readPageMetadata(options: { html: string; pageUrl: URL }) {
  const head =
    options.html
      .slice(0, MAX_HEAD_CHARS)
      .split(/<\/head>/i)
      .at(0) ?? "";
  const metas = [...head.matchAll(/<meta\b[^>]{0,2048}>/gi)].map((match) =>
    readAttributes(match[0]),
  );
  function meta(name: string) {
    return metas.find(
      (attributes) => (attributes.property ?? attributes.name) === name,
    )?.content;
  }
  const titleStart = head.search(/<title\b/i);
  const titleTagEnd = titleStart < 0 ? -1 : head.indexOf(">", titleStart);
  const titleTag =
    titleTagEnd < 0
      ? undefined
      : head
          .slice(titleTagEnd + 1)
          .split(/<\/title>/i)
          .at(0);
  const image = meta("og:image") ?? meta("twitter:image");
  const imageUrl = (() => {
    if (!image) return undefined;
    try {
      return new URL(image, options.pageUrl);
    } catch {
      return undefined;
    }
  })();
  return {
    title: clean(meta("og:title")) ?? clean(decodeEntities(titleTag ?? "")),
    imageUrl,
  };
}
