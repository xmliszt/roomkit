import { z } from "zod";

export const DesktopTailnetStatusSchema = z.object({
  kind: z.literal("desktop"),
  state: z.enum([
    "cli-missing",
    "unavailable",
    "disconnected",
    "needs-dns",
    "needs-https",
    "conflict",
    "account-changed",
    "disabled",
    "cleanup-pending",
    "routes-missing",
    "ready",
  ]),
  canDisable: z.boolean(),
  logins: z.array(z.string()),
  url: z.url().optional(),
});

export type DesktopTailnetStatus = z.infer<typeof DesktopTailnetStatusSchema>;

export const TailnetStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cli-missing") }),
  z.object({ kind: z.literal("unavailable") }),
  z.object({ kind: z.literal("disconnected") }),
  z.object({ kind: z.literal("needs-dns") }),
  z.object({
    kind: z.enum(["serve-not-configured", "roomkit-not-configured", "public"]),
    host: z.string(),
  }),
  z.object({ kind: z.literal("ready"), host: z.string() }),
  DesktopTailnetStatusSchema,
  z.object({ kind: z.literal("desktop-remote") }),
]);

export type TailnetStatus = z.infer<typeof TailnetStatusSchema>;
