export type AgentUsage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cacheRead: number | undefined;
  cacheWrite: number | undefined;
};

export type AgentEvent =
  | { kind: "init"; sessionId: string; model: string; tools: string[] }
  | {
      kind: "turn_usage";
      usage: AgentUsage;
      model: string;
      messageId?: string | undefined;
      cumulative?: boolean;
    }
  | {
      kind: "context_compacted";
      imagesElided: number;
      imagesDownscaled: number;
      tokensBefore: number;
      tokensAfter: number;
    }
  | { kind: "owner_text"; text: string }
  | { kind: "assistant_text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | {
      kind: "tool_result";
      toolUseId: string | undefined;
      isError: boolean;
      preview: string;
    }
  | {
      kind: "result";
      subtype: string;
      isError: boolean;
      stopReason: string | undefined;
      finalText: string;
      sessionId: string | undefined;

      sessionCostUsd: number | undefined;
      usage: AgentUsage;
      numTurns: number;
    }
  | { kind: "rate_limit"; info: unknown }
  | { kind: "other"; type: string; subtype: string | undefined };

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null;
}
function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readUsage(raw: unknown): AgentUsage {
  const u = isRecord(raw) ? raw : {};
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
  };
}

function previewContent(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 280);
  const text = arr(content)
    .map((block) =>
      isRecord(block) ? (str(block.text) ?? str(block.content) ?? "") : "",
    )
    .join(" ")
    .trim();
  return text.slice(0, 280);
}

function decodeAssistant(message: { [key: string]: unknown }): AgentEvent[] {
  const events: AgentEvent[] = [];

  if (isRecord(message.usage)) {
    events.push({
      kind: "turn_usage",
      usage: readUsage(message.usage),
      model: str(message.model) ?? "",
      messageId: str(message.id),
    });
  }
  for (const block of arr(message.content)) {
    if (!isRecord(block)) continue;
    const type = str(block.type);
    if (type === "text") {
      const text = str(block.text);
      if (text) events.push({ kind: "assistant_text", text });
    } else if (type === "thinking") {
      const text = str(block.thinking) ?? str(block.text);
      if (text) events.push({ kind: "thinking", text });
    } else if (type === "tool_use") {
      events.push({
        kind: "tool_use",
        id: str(block.id) ?? "",
        name: str(block.name) ?? "unknown",
        input: block.input,
      });
    }
  }
  return events;
}

function decodeUser(message: { [key: string]: unknown }): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const block of arr(message.content)) {
    if (!isRecord(block) || str(block.type) !== "tool_result") continue;
    events.push({
      kind: "tool_result",
      toolUseId: str(block.tool_use_id),
      isError: block.is_error === true,
      preview: previewContent(block.content),
    });
  }
  return events;
}

export function decodeLine(line: string): AgentEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!isRecord(raw)) return [];

  const type = str(raw.type);
  const subtype = str(raw.subtype);

  if (type === "system" && subtype === "init") {
    return [
      {
        kind: "init",
        sessionId: str(raw.session_id) ?? "",
        model: str(raw.model) ?? "",
        tools: arr(raw.tools).flatMap((t) =>
          typeof t === "string" ? [t] : [],
        ),
      },
    ];
  }
  if (type === "assistant" && isRecord(raw.message))
    return decodeAssistant(raw.message);
  if (type === "user" && isRecord(raw.message)) return decodeUser(raw.message);
  if (type === "result") {
    return [
      {
        kind: "result",
        subtype: subtype ?? "unknown",
        isError: raw.is_error === true,
        stopReason: str(raw.stop_reason),
        finalText: str(raw.result) ?? "",
        sessionId: str(raw.session_id) ?? "",
        sessionCostUsd: num(raw.total_cost_usd),
        usage: readUsage(raw.usage),
        numTurns: num(raw.num_turns) ?? 0,
      },
    ];
  }
  if (type === "rate_limit_event")
    return [{ kind: "rate_limit", info: raw.rate_limit_info }];
  return [{ kind: "other", type: type ?? "unknown", subtype }];
}
