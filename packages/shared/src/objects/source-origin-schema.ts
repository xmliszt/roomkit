import { z } from "zod";

export const SourceOriginSchema = z.enum([
  "inventory",
  "chat-photo",
  "web",
  "prompt",
  "variant",
  "catalog",
]);
