import { z } from "zod";
import { AppLocaleSchema } from "./app-locale.ts";

export const LanguagePreferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending") }).strict(),
  z.object({ kind: z.literal("selected"), locale: AppLocaleSchema }).strict(),
]);

export type LanguagePreference = z.infer<typeof LanguagePreferenceSchema>;
