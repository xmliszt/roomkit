import { verifyChatPhotos } from "../packages/daemon/src/photos/verify-chat-photos.ts";

await verifyChatPhotos();
process.stdout.write(
  "gate:b5 passed: two upright photos, Claude and Codex new/resumed turns, photo-only choice, media routes and file-read boundaries\n",
);
