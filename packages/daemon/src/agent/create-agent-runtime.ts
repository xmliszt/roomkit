import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { Role } from "@planner/shared/src/config/config-schema.ts";
import { readProcessIdentity } from "../jobs/read-process-identity.ts";
import { createTokenScrubber } from "../util/create-token-scrubber.ts";
import { resolveExecutable } from "../util/resolve-executable.ts";
import { writeJson } from "../util/write-json.ts";
import { writeHookSettings } from "./hooks.ts";
import type { TaskRunOptions } from "./run-options.ts";
import { RuntimeRouter } from "./runtime.ts";
import { type SessionRecord, SessionRecordSchema } from "./session-record.ts";

type TurnOptions = Pick<
  TaskRunOptions,
  | "rates"
  | "binary"
  | "prompt"
  | "imagePaths"
  | "newSessionPrompt"
  | "mcpConfigPath"
  | "allowedTools"
  | "maxTurns"
  | "readableDirs"
  | "effort"
  | "signal"
  | "onEvent"
  | "onSpawn"
  | "timeoutMs"
> & {
  project: string;
  session: {
    id?: string;
    role: Role;
    cli: "claude" | "codex";
  };
  readOnly?: boolean | undefined;
  extraEnv?: NodeJS.ProcessEnv;
  systemPrompt: string;
  model: string;
  cwd?: string;
};

export function createAgentRuntime(
  options: { env?: NodeJS.ProcessEnv; router?: RuntimeRouter } = {},
) {
  const router = options.router ?? new RuntimeRouter();
  const env = options.env ?? process.env;
  const running = new Set<string>();

  async function runTurn(input: TurnOptions) {
    const project = resolve(input.project);
    const directory = join(project, ".planner", "sessions");
    mkdirSync(directory, { recursive: true });
    const role = input.session.role;
    const id = SessionRecordSchema.shape.id.parse(
      input.session.id ?? `${role}-1`,
    );
    if (!id.startsWith(`${role}-`))
      throw new Error("Session id must match its role");
    const path = join(directory, `${id}.json`);
    if (running.has(path))
      throw new Error(`Agent session ${id} already has a running turn`);
    const saved = existsSync(path)
      ? SessionRecordSchema.parse(JSON.parse(readFileSync(path, "utf8")))
      : undefined;
    if (saved && saved.role !== role)
      throw new Error("A saved session cannot change its role");
    const previous =
      saved && saved.cli !== input.session.cli
        ? { ...saved, cli: input.session.cli, sessionId: undefined }
        : saved;
    const startedAtMs = Date.now();
    const createdAt = previous?.createdAt ?? new Date().toISOString();
    const record: SessionRecord = previous ?? {
      id,
      role,
      cli: input.session.cli,
      model: input.model,
      sessionId: undefined,
      turns: 0,
      durationMs: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      sessionCostUsd: 0,
      tokens: 0,
      status: "idle",
      createdAt,
      lastTurnAt: createdAt,
      note: "",
    };
    const sessionId = record.sessionId || randomUUID();
    const interruptKey = `${project}:${id}`;
    const binary = resolveExecutable({
      env,
      command:
        input.binary ??
        (input.session.cli === "claude"
          ? env.PLANNER_CLAUDE_BIN
          : env.PLANNER_CODEX_BIN) ??
        input.session.cli,
    });
    const redact = createTokenScrubber(env);
    const logsDirectory = join(project, ".planner", "logs");
    mkdirSync(logsDirectory, { recursive: true });
    const transcriptNumber =
      Math.max(
        0,
        ...readdirSync(logsDirectory)
          .filter(
            (file) => file.startsWith(`${id}-`) && file.endsWith(".jsonl"),
          )
          .map((file) => Number(file.slice(id.length + 1, -6)))
          .filter(Number.isFinite),
      ) + 1;
    const transcriptPath = join(
      logsDirectory,
      `${id}-${transcriptNumber}.jsonl`,
    );
    writeFileSync(transcriptPath, "", { flag: "wx", mode: 0o600 });
    const current: SessionRecord = {
      ...record,
      model: input.model,
      transcriptNumber,
      sessionId,
      status: "running",
      lastTurnAt: new Date().toISOString(),
    };
    function persistCurrent() {
      writeJson({ path, value: current });
    }
    const settingsPath = writeHookSettings({
      dir: join(directory, `${id}-settings`),
    });
    running.add(path);
    try {
      persistCurrent();
      const result = await router.run({
        ...input,
        cli: input.session.cli,
        sessionId,
        resume: !!record.sessionId,
        cwd: input.cwd ?? project,
        appendSystemPrompt: input.systemPrompt,
        transcriptPath,
        onSpawn(pid) {
          current.pid = pid;
          current.processIdentity = readProcessIdentity(pid);
          persistCurrent();
          input.onSpawn?.(pid);
        },
        settingsPath,
        interruptKey,
        binary,
        env: {
          ...env,
          ...input.extraEnv,
          PLANNER_PROJECT: project,
          PLANNER_SESSION: id,
          ...(input.readOnly
            ? {
                PLANNER_READ_ONLY: "1",
                PLANNER_TOOL_ALLOWLIST: JSON.stringify(
                  input.allowedTools ?? [],
                ),
              }
            : {}),
        },
        onUsage(update) {
          const sameSession = record.sessionId === update.sessionId;
          const cumulative = input.session.cli === "codex";
          const baseline = sameSession
            ? (record.codexUsage ?? record.usage)
            : undefined;
          const total = (field: keyof SessionRecord["usage"]) =>
            record.usage[field] +
            Math.max(
              0,
              (update.usage[field] ?? 0) -
                (cumulative ? (baseline?.[field] ?? 0) : 0),
            );
          current.usage = {
            inputTokens: total("inputTokens"),
            outputTokens: total("outputTokens"),
            cacheRead: total("cacheRead"),
            cacheWrite: total("cacheWrite"),
          };
          if (
            cumulative &&
            Object.values(update.usage).some((value) => value !== undefined)
          )
            current.codexUsage = {
              inputTokens: update.usage.inputTokens ?? 0,
              outputTokens: update.usage.outputTokens ?? 0,
              cacheRead: update.usage.cacheRead ?? 0,
              cacheWrite: update.usage.cacheWrite ?? 0,
            };
          current.tokens = Object.values(current.usage).reduce(
            (sum, value) => sum + value,
            0,
          );
          current.costUsd =
            record.costUsd +
            (update.sessionCostUsd === undefined
              ? (update.costUsd ?? 0)
              : Math.max(
                  0,
                  update.sessionCostUsd -
                    (sameSession ? record.sessionCostUsd : 0),
                ));
          current.sessionCostUsd =
            update.sessionCostUsd ??
            (sameSession ? record.sessionCostUsd : 0) + (update.costUsd ?? 0);
          persistCurrent();
        },
        onEvent(event) {
          if (event.kind === "init") {
            if (
              input.session.cli === "codex" &&
              current.sessionId !== event.sessionId
            )
              current.codexUsage = {
                inputTokens: 0,
                outputTokens: 0,
                cacheRead: 0,
                cacheWrite: 0,
              };
            current.sessionId = event.sessionId;
            persistCurrent();
          }
          input.onEvent?.(event);
        },
      });
      writeJson({
        path,
        value: {
          ...current,
          durationMs: record.durationMs + Date.now() - startedAtMs,
          sessionId: result.sessionId,
          turns: record.turns + result.numTurns,
          usage: current.usage,
          codexUsage: current.codexUsage,
          costUsd:
            record.costUsd +
            (result.sessionCostUsd === undefined
              ? (result.costUsd ?? 0)
              : result.sessionCostUsd -
                (record.sessionId === result.sessionId
                  ? record.sessionCostUsd
                  : 0)),
          sessionCostUsd:
            result.sessionCostUsd ??
            (record.sessionId === result.sessionId
              ? record.sessionCostUsd
              : 0) + (result.costUsd ?? 0),
          tokens: current.tokens,
          status: result.interrupted
            ? "interrupted"
            : result.stopReason === "timeout"
              ? "timeout"
              : result.usageLimit
                ? "usage_limit"
                : result.isError
                  ? "error"
                  : "idle",
          lastTurnAt: new Date().toISOString(),
          note: redact(result.finalText),
          pid: undefined,
          processIdentity: undefined,
        } satisfies SessionRecord,
      });
      return result;
    } catch (error) {
      writeJson({
        path,
        value: {
          ...current,
          durationMs: record.durationMs + Date.now() - startedAtMs,
          status: "error",
          note: redact(error instanceof Error ? error.message : String(error)),
          pid: undefined,
          processIdentity: undefined,
        } satisfies SessionRecord,
      });
      throw error;
    } finally {
      running.delete(path);
    }
  }

  return {
    runTurn,
    interrupt(input: { project: string; session: string }) {
      return router.interrupt(`${resolve(input.project)}:${input.session}`);
    },
    killAll() {
      router.killAll();
    },
  };
}
