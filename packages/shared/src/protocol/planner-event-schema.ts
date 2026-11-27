import { z } from "zod";
import { ChatBlockSchema } from "../chat/chat-block-schema.ts";
import { ChatMessageSchema } from "../chat/chat-message-schema.ts";
import { CommandSchema } from "../commands/command-schema.ts";
import { JobSchema } from "../jobs/job-schema.ts";
import { PreflightSchema } from "../preflight/preflight-schema.ts";
import { ProjectIdSchema } from "../project/project-id-schema.ts";
import { ProjectSummarySchema } from "../project/project-schema.ts";
import { IdSchema } from "../scene/id-schema.ts";

const messageId = z.string().min(1);
const blockIndex = z.number().int().nonnegative();

export const PlannerEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("project.created"),
      project: ProjectSummarySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("project.renamed"),
      project: ProjectSummarySchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("project.removed"), projectId: ProjectIdSchema })
    .strict(),
  z
    .object({
      kind: z.literal("scene.changed"),
      projectId: ProjectIdSchema,
      command: CommandSchema,
      revision: z.number().int().positive(),
      requestId: z.guid().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("job.updated"), job: JobSchema }).strict(),
  z
    .object({
      kind: z.literal("job.log"),
      jobId: IdSchema,
      firstLineIndex: z.number().int().nonnegative(),
      lines: z.array(z.string()).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("preflight.updated"),
      preflight: PreflightSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("chat.message.added"),
      projectId: ProjectIdSchema,
      message: ChatMessageSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("chat.text.appended"),
      projectId: ProjectIdSchema,
      messageId,
      blockIndex,
      text: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("chat.block.set"),
      projectId: ProjectIdSchema,
      messageId,
      blockIndex,
      block: ChatBlockSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("chat.message.finished"),
      projectId: ProjectIdSchema,
      messageId,
      status: z.enum(["done", "failed", "stopped"]),
    })
    .strict(),
]);

export type PlannerEvent = z.infer<typeof PlannerEventSchema>;
