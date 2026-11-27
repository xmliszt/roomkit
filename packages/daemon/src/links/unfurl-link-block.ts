import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import { readPageMetadata } from "./read-page-metadata.ts";
import { safeGet } from "./safe-get.ts";

type LinkBlock = Extract<ChatBlock, { kind: "link" }>;

const IMAGE_EXTENSIONS: { [contentType: string]: string } = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** Fetch the page of a `link` block and return the block with its title and its OG image saved under the project's `.planner/links/`; fields that cannot be fetched stay as they were. */
export async function unfurlLinkBlock(options: {
  block: LinkBlock;
  projectFolder: string;
  allowedHosts: string[];
  logWarning: (message: string) => void;
}): Promise<LinkBlock> {
  const page = await safeGet({
    url: options.block.url,
    allowedHosts: options.allowedHosts,
    maxBytes: 512 * 1024,
    timeoutMs: 5000,
    isTruncationAllowed: true,
  });
  if (
    page.contentType !== "text/html" &&
    page.contentType !== "application/xhtml+xml"
  )
    return options.block;
  const metadata = readPageMetadata({
    html: page.body.toString("utf8"),
    pageUrl: page.url,
  });
  const imageSrc = await (async () => {
    if (metadata.imageUrl === undefined) return undefined;
    try {
      const image = await safeGet({
        url: metadata.imageUrl.href,
        allowedHosts: options.allowedHosts,
        maxBytes: 2 * 1024 * 1024,
        timeoutMs: 5000,
        isTruncationAllowed: false,
      });
      const extension = IMAGE_EXTENSIONS[image.contentType ?? ""];
      if (
        extension === undefined ||
        !existsSync(join(options.projectFolder, "project.json"))
      )
        return undefined;
      const fileName = `${createHash("sha256").update(metadata.imageUrl.href).digest("hex").slice(0, 32)}.${extension}`;
      const folder = join(options.projectFolder, ".planner", "links");
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, fileName), image.body, { mode: 0o600 });
      return `.planner/links/${fileName}`;
    } catch (error) {
      options.logWarning(`link image not fetched: ${String(error)}`);
      return undefined;
    }
  })();
  return {
    ...options.block,
    ...(metadata.title === undefined ? {} : { title: metadata.title }),
    ...(imageSrc === undefined ? {} : { imageSrc }),
  };
}
