import { test } from "vitest";
import { verifyChatPhotos } from "./verify-chat-photos.ts";

test(
  "photo messages reach both designers and media routes enforce access",
  verifyChatPhotos,
  30_000,
);
