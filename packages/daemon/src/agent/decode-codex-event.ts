import { z } from "zod";
import type { AgentEvent } from "./stream-json.ts";

const eventSchema = z.object({
  type: z.string(),
  thread_id: z.string().optional(),
  message: z.string().optional(),
  error: z.object({ message: z.string() }).optional(),
  usage: z
    .object({
      input_tokens: z.number(),
      cached_input_tokens: z.number().optional(),
      output_tokens: z.number(),
    })
    .optional(),
  item: z
    .object({
      id: z.string(),
      type: z.string(),
      text: z.string().optional(),
      command: z.string().optional(),
      aggregated_output: z.string().optional(),
      exit_code: z.number().nullable().optional(),
      status: z.string().optional(),
      server: z.string().optional(),
      tool: z.string().optional(),
      arguments: z.unknown().optional(),
      result: z.unknown().optional(),
      error: z.unknown().optional(),
      changes: z
        .array(z.object({ path: z.string(), kind: z.string() }))
        .optional(),
    })
    .optional(),
});

export function decodeCodexEvent(options: {
  line: string;
  model: string;
}): AgentEvent[] {
  const parsed = (() => {
    try {
      return eventSchema.safeParse(JSON.parse(options.line));
    } catch {
      return undefined;
    }
  })();
  if (!parsed?.success) return [];
  const event = parsed.data;
  if (event.type === "thread.started" && event.thread_id) {
    return [
      {
        kind: "init",
        sessionId: event.thread_id,
        model: options.model,
        tools: [],
      },
    ];
  }
  if (event.type === "turn.completed" && event.usage) {
    return [
      {
        kind: "turn_usage",
        cumulative: true,
        model: options.model,
        usage: {
          inputTokens: Math.max(
            0,
            event.usage.input_tokens - (event.usage.cached_input_tokens ?? 0),
          ),
          outputTokens: event.usage.output_tokens,
          cacheRead: event.usage.cached_input_tokens,
          cacheWrite: undefined,
        },
      },
    ];
  }
  if (event.type === "turn.failed" || event.type === "error") {
    return [
      {
        kind: "result",
        subtype: "error",
        isError: true,
        stopReason: "agent_error",
        finalText:
          event.error?.message ??
          event.message ??
          "Codex could not finish this turn.",
        sessionId: "",
        sessionCostUsd: undefined,
        numTurns: 0,
        usage: {
          inputTokens: undefined,
          outputTokens: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
      },
    ];
  }
  const item = event.item;
  if (!item) return [];
  const completed = event.type === "item.completed";
  if (
    completed &&
    item.text &&
    (item.type === "agent_message" || item.type === "reasoning")
  ) {
    return [
      {
        kind: item.type === "agent_message" ? "assistant_text" : "thinking",
        text: item.text,
      },
    ];
  }
  if (item.type === "command_execution" || item.type === "mcp_tool_call") {
    if (event.type === "item.started") {
      return [
        {
          kind: "tool_use",
          id: item.id,
          name:
            item.type === "command_execution"
              ? "Bash"
              : `mcp__${item.server}__${item.tool}`,
          input:
            item.type === "command_execution"
              ? { command: item.command }
              : item.arguments,
        },
      ];
    }
    if (completed)
      return [
        {
          kind: "tool_result",
          toolUseId: item.id,
          isError:
            item.status === "failed" ||
            item.error != null ||
            (item.exit_code != null && item.exit_code !== 0),
          preview: (
            item.aggregated_output ??
            (item.error == null
              ? readToolResultText(item.result)
              : JSON.stringify(item.error)) ??
            "Completed"
          ).slice(0, 2000),
        },
      ];
  }
  if (completed && item.type === "file_change") {
    return [
      {
        kind: "tool_use",
        id: item.id,
        name: "Edit",
        input: { changes: item.changes },
      },
      {
        kind: "tool_result",
        toolUseId: item.id,
        isError: item.status === "failed",
        preview:
          item.changes
            ?.map((change) => `${change.kind}: ${change.path}`)
            .join("\n") ?? "Files updated",
      },
    ];
  }
  return [];
}

function readToolResultText(result: unknown) {
  if (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray(result.content)
  )
    return result.content
      .flatMap((part: unknown) =>
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n");
  return JSON.stringify(result);
}
