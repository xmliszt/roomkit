import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  CodingAgentUsage,
  CodingAgentUsageWindow,
} from "@planner/shared/src/agents/coding-agent-status-schema.ts";
import { z } from "zod";
import { exec } from "../util/exec.ts";

export type FetchJson = (options: {
  url: string;
  headers: { [key: string]: string };
}) => Promise<{ status: number; body: unknown }>;

const codexAuthSchema = z.object({
  tokens: z
    .object({
      access_token: z.string().min(1),
      account_id: z.string().optional(),
    })
    .optional(),
});
const codexWindowSchema = z.object({
  used_percent: z.number(),
  limit_window_seconds: z.number().optional(),
  reset_at: z.number().optional(),
});
const codexUsageSchema = z.object({
  plan_type: z.string().optional(),
  rate_limit: z
    .object({
      primary_window: codexWindowSchema.nullable().optional(),
      secondary_window: codexWindowSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
});

const claudeCredentialsSchema = z.object({
  claudeAiOauth: z
    .object({
      accessToken: z.string().min(1),
      scopes: z.array(z.string()).optional(),
      subscriptionType: z.string().optional(),
    })
    .optional(),
});
const claudeWindowSchema = z.object({
  utilization: z.number(),
  resets_at: z.string().nullable().optional(),
});
const claudeLimitSchema = z.object({
  kind: z.string(),
  percent: z.number(),
  resets_at: z.string().nullable().optional(),
  scope: z
    .object({
      model: z
        .object({ display_name: z.string().nullable().optional() })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});
const claudeUsageSchema = z.object({
  limits: z.array(claudeLimitSchema).nullable().optional(),
  five_hour: claudeWindowSchema.nullable().optional(),
  seven_day: claudeWindowSchema.nullable().optional(),
  seven_day_opus: claudeWindowSchema.nullable().optional(),
  seven_day_sonnet: claudeWindowSchema.nullable().optional(),
});

async function defaultFetchJson(options: {
  url: string;
  headers: { [key: string]: string };
}) {
  const response = await fetch(options.url, {
    headers: options.headers,
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  const body: unknown = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  })();
  return { status: response.status, body };
}

function windowLabel(options: {
  seconds: number | undefined;
  fallback: string;
}) {
  const { seconds, fallback } = options;
  if (seconds === undefined) return fallback;
  if (seconds >= 6 * 24 * 3600) return "Weekly";
  const hours = Math.round(seconds / 3600);
  return hours >= 1 ? `${hours}-hour` : `${Math.round(seconds / 60)}-minute`;
}

function claudeLimitLabel(limit: z.infer<typeof claudeLimitSchema>) {
  if (limit.kind === "session") return "5-hour";
  if (limit.kind === "weekly_all") return "Weekly";
  if (limit.kind === "weekly_scoped") {
    const model = limit.scope?.model?.display_name;
    return model ? `Weekly · ${model}` : limit.kind;
  }
  return limit.kind;
}

function hasAnyKey(options: { body: unknown; keys: string[] }) {
  const { body } = options;
  return (
    typeof body === "object" &&
    body !== null &&
    options.keys.some((key) => key in body)
  );
}

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export async function readCodingAgentUsage(options: {
  kind: "claude" | "codex";
  plan?: string;
  fetchJson?: FetchJson;
  runCommand?: typeof exec;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<CodingAgentUsage> {
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const runCommand = options.runCommand ?? exec;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const fetchedAt = new Date().toISOString();
  const unavailable = (
    error: NonNullable<CodingAgentUsage["error"]>,
  ): CodingAgentUsage => ({
    ...(options.plan ? { plan: options.plan } : {}),
    windows: [],
    error,
    fetchedAt,
  });
  function failedResponse(input: { name: string; status: number }) {
    if (input.status === 429)
      return unavailable({
        kind: "rate-limited",
        message: `${input.name} usage is rate limited (HTTP 429). Check again later.`,
      });
    if (input.status !== 200)
      return unavailable({
        kind: "http-status",
        message: `${input.name} usage is unavailable right now (HTTP ${input.status}).`,
      });
    return unavailable({
      kind: "changed-shape",
      message: `${input.name} usage answered in a form this app does not know.`,
    });
  }

  try {
    if (options.kind === "codex") {
      const auth = codexAuthSchema.safeParse(
        readJsonFile(
          join(
            env.CODEX_HOME ?? join(env.HOME ?? homedir(), ".codex"),
            "auth.json",
          ),
        ),
      );
      const tokens = auth.success ? auth.data.tokens : undefined;
      if (!tokens)
        return unavailable({
          kind: "not-signed-in",
          message:
            "Usage needs a ChatGPT sign-in (codex login). API-key sign-ins do not report plan limits.",
        });
      const response = await fetchJson({
        url: "https://chatgpt.com/backend-api/wham/usage",
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
          "User-Agent": "codex-cli",
          ...(tokens.account_id
            ? { "ChatGPT-Account-Id": tokens.account_id }
            : {}),
        },
      });
      if (response.status === 401 || response.status === 403)
        return unavailable({
          kind: "refused",
          message:
            "The stored Codex sign-in was refused. Run any codex command once to refresh it, then check again.",
        });
      const parsed = codexUsageSchema.safeParse(response.body);
      if (
        response.status !== 200 ||
        !parsed.success ||
        !hasAnyKey({ body: response.body, keys: ["plan_type", "rate_limit"] })
      )
        return failedResponse({
          name: "Codex",
          status: response.status,
        });
      const windows: CodingAgentUsageWindow[] = [
        parsed.data.rate_limit?.primary_window
          ? {
              label: windowLabel({
                seconds:
                  parsed.data.rate_limit.primary_window.limit_window_seconds,
                fallback: "Session",
              }),
              usedPercent: parsed.data.rate_limit.primary_window.used_percent,
              resetsAt: parsed.data.rate_limit.primary_window.reset_at
                ? new Date(
                    parsed.data.rate_limit.primary_window.reset_at * 1000,
                  ).toISOString()
                : undefined,
            }
          : undefined,
        parsed.data.rate_limit?.secondary_window
          ? {
              label: windowLabel({
                seconds:
                  parsed.data.rate_limit.secondary_window.limit_window_seconds,
                fallback: "Weekly",
              }),
              usedPercent: parsed.data.rate_limit.secondary_window.used_percent,
              resetsAt: parsed.data.rate_limit.secondary_window.reset_at
                ? new Date(
                    parsed.data.rate_limit.secondary_window.reset_at * 1000,
                  ).toISOString()
                : undefined,
            }
          : undefined,
      ].filter((window) => window !== undefined);
      return {
        ...(parsed.data.plan_type ? { plan: parsed.data.plan_type } : {}),
        windows,
        fetchedAt,
      };
    }

    const keychain =
      platform === "darwin" &&
      env.HOME === process.env.HOME &&
      !env.CLAUDE_CONFIG_DIR
        ? await runCommand({
            command: "security",
            args: [
              "find-generic-password",
              "-s",
              "Claude Code-credentials",
              "-w",
            ],
            timeoutMs: 5000,
            env,
          })
        : undefined;
    const raw: unknown =
      keychain?.code === 0
        ? (() => {
            try {
              return JSON.parse(keychain.stdout.trim());
            } catch {
              return undefined;
            }
          })()
        : readJsonFile(
            join(
              env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? homedir(), ".claude"),
              ".credentials.json",
            ),
          );
    const credentials = claudeCredentialsSchema.safeParse(raw);
    const oauth = credentials.success
      ? credentials.data.claudeAiOauth
      : undefined;
    if (!oauth)
      return unavailable({
        kind: "not-signed-in",
        message:
          "Usage needs a claude.ai sign-in (run claude and log in). API-key sign-ins do not report plan limits.",
      });
    if (oauth.scopes && !oauth.scopes.includes("user:profile"))
      return unavailable({
        kind: "refused",
        message:
          "This Claude sign-in cannot report usage. Sign out and in again with claude to grant it.",
      });
    const response = await fetchJson({
      url: "https://api.anthropic.com/api/oauth/usage",
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        Accept: "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.1.0",
      },
    });
    if (response.status === 401 || response.status === 403)
      return unavailable({
        kind: "refused",
        message:
          "The stored Claude sign-in was refused. Run claude once to refresh it, then check again.",
      });
    const parsed = claudeUsageSchema.safeParse(response.body);
    if (
      response.status !== 200 ||
      !parsed.success ||
      !hasAnyKey({
        body: response.body,
        keys: [
          "limits",
          "five_hour",
          "seven_day",
          "seven_day_opus",
          "seven_day_sonnet",
        ],
      })
    )
      return failedResponse({
        name: "Claude",
        status: response.status,
      });
    const plan = options.plan ?? oauth.subscriptionType;
    const limits = parsed.data.limits;
    if (limits && limits.length > 0)
      return {
        ...(plan ? { plan } : {}),
        windows: limits.map((limit) => ({
          label: claudeLimitLabel(limit),
          usedPercent: limit.percent,
          ...(limit.resets_at ? { resetsAt: limit.resets_at } : {}),
        })),
        fetchedAt,
      };
    const windows = [
      ["5-hour", parsed.data.five_hour],
      ["Weekly", parsed.data.seven_day],
      ["Weekly · Opus", parsed.data.seven_day_opus],
      ["Weekly · Sonnet", parsed.data.seven_day_sonnet],
    ].flatMap(([label, window]) =>
      typeof label === "string" && window && typeof window === "object"
        ? [
            {
              label,
              usedPercent: window.utilization,
              ...(window.resets_at ? { resetsAt: window.resets_at } : {}),
            },
          ]
        : [],
    );
    return { ...(plan ? { plan } : {}), windows, fetchedAt };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError")
      return unavailable({
        kind: "timeout",
        message: "The usage request timed out. Check again later.",
      });
    return unavailable({ kind: "failed", message: "Usage check failed." });
  }
}
