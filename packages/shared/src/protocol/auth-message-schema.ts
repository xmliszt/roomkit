import { z } from "zod";

export const AuthMessageSchema = z
  .object({ type: z.literal("auth"), token: z.string() })
  .strict();

export const AuthOkMessageSchema = z.object({ type: z.literal("auth.ok") });

export const AuthErrorMessageSchema = z.object({
  type: z.literal("auth.error"),
  message: z.string(),
});
