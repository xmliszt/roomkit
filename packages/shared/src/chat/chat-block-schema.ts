import { z } from "zod";
import { CommandSchema } from "../commands/command-schema.ts";
import { OffsetDateTimeSchema } from "../protocol/date-time-schema.ts";
import { IdSchema } from "../scene/id-schema.ts";
import { SizeMismatchSchema } from "../scene/size-mismatch-schema.ts";
import { SizeSchema } from "../scene/size-schema.ts";
import { Vec2Schema } from "../scene/vec2-schema.ts";

const MediaFields = {
  src: z.string().min(1),
  fileName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
};

export const ChatBlockSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("render"),
        jobId: IdSchema,
        fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.png$/),
        sizeBytes: z.number().int().nonnegative(),
        widthPx: z.number().int().positive(),
        heightPx: z.number().int().positive(),
      })
      .strict(),
    z.object({ kind: z.literal("text"), markdown: z.string() }).strict(),
    z
      .object({
        kind: z.literal("item"),
        itemId: IdSchema,
        name: z.string(),
        assetId: IdSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("image"),
        photoId: IdSchema,
        fileName: MediaFields.fileName,
        sizeBytes: MediaFields.sizeBytes,
      })
      .strict(),
    z
      .object({
        kind: z.literal("video"),
        ...MediaFields,
        format: z.enum(["mp4", "webm", "gif"]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("link"),
        url: z.string().url(),
        domain: z.string().min(1),
        title: z.string().optional(),
        faviconSrc: z.string().min(1).optional(),
        imageSrc: z.string().min(1).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("file"),
        ...MediaFields,
        fileType: z.string().min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("asset"),
        assetId: IdSchema,
        name: z.string(),
        sizeM: SizeSchema,
        sizeMismatches: z.array(SizeMismatchSchema).optional(),
      })
      .strict(),
    z.object({ kind: z.literal("job"), jobId: IdSchema }).strict(),
    z
      .object({
        kind: z.literal("tool"),
        toolCallId: z.string().min(1),
        name: z.string().min(1),
        summary: z.string(),
        status: z.enum(["running", "done", "failed"]),
        durationMs: z.number().nonnegative().optional(),
        arguments: z.unknown().optional(),
        result: z.unknown().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("diff"),
        changes: z
          .array(
            z
              .object({
                label: z.string().min(1),
                before: z.string(),
                after: z.string(),
              })
              .strict(),
          )
          .min(1),
        undo: z.array(CommandSchema),
      })
      .strict(),
    z
      .object({
        kind: z.literal("capture-request"),
        wallId: IdSchema,
        standM: Vec2Schema,
        lookAtM: Vec2Schema,
        text: z.string(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("choice"),
        choiceId: z.string().min(1),
        question: z.string().min(1),
        options: z
          .array(
            z
              .object({ id: z.string().min(1), label: z.string().min(1) })
              .strict(),
          )
          .min(2)
          .max(4),
        selectedOptionId: z.string().min(1).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("notice"),
        text: z.string().min(1),
        detail: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("error") }).strict(),
          z
            .object({
              kind: z.literal("usage-limit"),
              resetAt: OffsetDateTimeSchema.optional(),
            })
            .strict(),
          z
            .object({
              kind: z.literal("missing-requirement"),
              setupFeature: z
                .enum([
                  "claude",
                  "codex",
                  "blender",
                  "reconstruction",
                  "sam3d",
                  "trellis2",
                ])
                .optional(),
              settingsSection: z.enum([
                "agents",
                "blender",
                "python",
                "connections",
              ]),
            })
            .strict(),
        ]),
      })
      .strict(),
  ])
  .refine(
    (block) =>
      block.kind !== "render" || block.fileName === `${block.jobId}.png`,
    "Render file name must match its job ID",
  );

export type ChatBlock = z.infer<typeof ChatBlockSchema>;
