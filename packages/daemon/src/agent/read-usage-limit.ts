import { z } from "zod";

export function readUsageLimit(options: { info?: unknown; text?: string }) {
  const parsed = z
    .object({
      status: z.string().optional(),
      resetsAt: z.union([z.number(), z.string()]).optional(),
      resets_at: z.union([z.number(), z.string()]).optional(),
    })
    .safeParse(options.info);
  const info = parsed.success ? parsed.data : undefined;
  const text = options.text ?? "";
  const piped = /usage limit reached\|(\d{9,13})/i.exec(text)?.at(1);
  const rejected =
    ["rejected", "exceeded", "blocked"].includes(info?.status ?? "") ||
    /\b(usage|rate) limit\b/i.test(text);
  if (!rejected) return undefined;
  const raw =
    info?.resetsAt ?? info?.resets_at ?? (piped ? Number(piped) : undefined);
  const date =
    typeof raw === "number"
      ? new Date(raw < 1e12 ? raw * 1000 : raw)
      : new Date(raw ?? "");
  return {
    resetsAt: Number.isNaN(date.getTime()) ? undefined : date.toISOString(),
    message: text || "The provider's usage limit was reached.",
  };
}
