import { z } from "zod";

export const TailnetLoginSchema = z
  .string()
  .trim()
  .min(1)
  .max(254)
  .regex(/^[!-+\--~]+$/);
