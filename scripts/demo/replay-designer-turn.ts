import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChatMessageSchema } from "@planner/shared/src/chat/chat-message-schema.ts";
import { GenerationSpecSchema } from "@planner/shared/src/generation/generation-spec-schema.ts";
import { PhotosSchema } from "@planner/shared/src/photos/photo-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { z } from "zod";
import { ATTACHED_PHOTOS_HEADING } from "../../packages/daemon/src/chat/create-designer-chat.ts";

function hashPhotos(options: { photosFolder: string; photoIds: string[] }) {
  const photos = PhotosSchema.parse(
    JSON.parse(readFileSync(join(options.photosFolder, "photos.json"), "utf8")),
  ).photos.filter((photo) => options.photoIds.includes(photo.photoId));
  return Object.fromEntries(
    photos.map((photo) => [
      photo.photoId,
      createHash("sha256")
        .update(readFileSync(join(options.photosFolder, photo.sourceFileName)))
        .digest("hex"),
    ]),
  );
}

/**
 * Return the fake-CLI steps that replay the saved designer `asset_generate` call and reply from `source`/`chat.json` for the photos attached in `prompt`, with saved photo ids replaced by the ids of the same photo files in `projectFolder` and the placement replaced by that of the `heldItems` item with the call's name, when there is one.
 */
export function replayDesignerTurn(options: {
  source: string;
  projectFolder: string;
  prompt: string;
  heldItems: Item[];
}) {
  const lines = options.prompt.split("\n");
  const heading = lines.lastIndexOf(ATTACHED_PHOTOS_HEADING);
  const attached =
    heading < 0
      ? []
      : z
          .array(z.string())
          .parse(JSON.parse(lines.at(heading + 1) ?? "[]"))
          .flatMap((path) => /([^/]+)\.jpg$/.exec(path)?.at(1) ?? []);
  if (attached.length === 0)
    throw new Error("Replay designer turns need an attached photo");
  const messages = ChatMessageSchema.array().parse(
    JSON.parse(readFileSync(join(options.source, "chat.json"), "utf8")),
  );
  const currentHashes = hashPhotos({
    photosFolder: join(options.projectFolder, "photos"),
    photoIds: attached,
  });
  const savedHashes = hashPhotos({
    photosFolder: join(options.source, "photos"),
    photoIds: messages.flatMap((message) =>
      message.blocks.flatMap((block) =>
        block.kind === "image" ? [block.photoId] : [],
      ),
    ),
  });
  const replayIds = Object.fromEntries(
    Object.entries(savedHashes).flatMap(([savedId, hash]) => {
      const replayId = attached.find(
        (photoId) => currentHashes[photoId] === hash,
      );
      return replayId ? [[savedId, replayId]] : [];
    }),
  );
  const request = messages.findLastIndex(
    (message) =>
      message.author.kind === "user" &&
      message.blocks.some(
        (block) => block.kind === "image" && replayIds[block.photoId],
      ),
  );
  const reply = messages
    .slice(request + 1)
    .find(
      (message) =>
        message.author.kind === "agent" && message.author.role === "designer",
    );
  const call = reply?.blocks.find(
    (block) => block.kind === "tool" && block.name === "asset_generate",
  );
  if (request < 0 || call?.kind !== "tool")
    throw new Error("No saved designer asset_generate for the attached photo");
  const spec = GenerationSpecSchema.parse(call.arguments);
  const placement =
    options.heldItems.find((item) => item.name === spec.name)?.placement ??
    spec.placement;
  function replayId(savedId: string) {
    const id = replayIds[savedId];
    if (!id) throw new Error(`Saved photo ${savedId} was not attached`);
    return id;
  }
  const reference =
    spec.reference.kind === "photo"
      ? {
          ...spec.reference,
          photoId: replayId(spec.reference.photoId),
          ...(spec.reference.extraPhotoIds
            ? { extraPhotoIds: spec.reference.extraPhotoIds.map(replayId) }
            : {}),
        }
      : spec.reference;
  return [
    {
      kind: "tool",
      name: "asset_generate",
      arguments: { ...spec, placement, reference },
    },
    {
      kind: "text",
      text: (reply?.blocks ?? [])
        .flatMap((block) => (block.kind === "text" ? [block.markdown] : []))
        .join("\n\n"),
    },
  ];
}
