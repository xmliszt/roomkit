import { test } from "vitest";
import { verifyChatItemRefs } from "./verify-chat-item-refs.ts";

test(
  "validates project item references and sends their IDs to both fake CLIs",
  verifyChatItemRefs,
  30000,
);
