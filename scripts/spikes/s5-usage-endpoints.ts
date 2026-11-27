import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

type Env = { [key: string]: string | undefined };
type JsonObject = { [key: string]: unknown };
type Row = { label: string; value: string };

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type FetchResult =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "failed"; reason: string };

type UsageWindow = {
  label: string;
  usedPercent: number;
  resetsAt: string | undefined;
  resetCheck: string;
};

type WindowRead =
  | { kind: "window"; window: UsageWindow }
  | { kind: "problem"; text: string };

type Usage =
  | {
      kind: "available";
      windows: UsageWindow[];
      userAgent: string;
      shape: string[];
      notes: string[];
    }
  | { kind: "unavailable"; reason: string; shape: string[]; notes: string[] };

type CliReport = { cli: "claude" | "codex"; rows: Row[]; usage: Usage };

type VersionRead =
  | { kind: "found"; text: string }
  | { kind: "failed"; reason: string };

type ClaudeCredentials =
  | {
      kind: "found";
      accessToken: string;
      plan: string | undefined;
      expiresAtMs: number | undefined;
      sourceName: string;
      hasScopeList: boolean;
    }
  | { kind: "missing"; reason: string };

const claudeUserAgent = "claude-code/2.1.0";
const codexUserAgent = "codex-cli";
const commandTimeoutMs = 5000;
const fetchTimeoutMs = 8000;
const clockSlackMs = 60_000;
const hourSeconds = 3600;
const weekSeconds = 7 * 24 * hourSeconds;

const claudeWindows = [
  { key: "five_hour", label: "5-hour", windowSeconds: 5 * hourSeconds },
  { key: "seven_day", label: "Weekly", windowSeconds: weekSeconds },
  { key: "seven_day_opus", label: "Weekly · Opus", windowSeconds: weekSeconds },
  {
    key: "seven_day_sonnet",
    label: "Weekly · Sonnet",
    windowSeconds: weekSeconds,
  },
];

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function shortText(value: unknown) {
  return stringOrUndefined(value)?.slice(0, 60);
}

function readTextFile(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function typeName(value: unknown) {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

function errorCode(error: unknown) {
  const source =
    error instanceof Error && isRecord(error.cause) ? error.cause : error;
  return isRecord(source) && typeof source.code === "string"
    ? ` ${source.code}`
    : "";
}

function shapeKey(key: string) {
  return /^[a-z][a-z_]{0,39}$/.test(key) ? key : "<key>";
}

function describeShape(options: { value: unknown; path: string }): string[] {
  const { value, path } = options;
  if (Array.isArray(value))
    return value.length === 0
      ? [`${path}[]: empty`]
      : [
          ...new Set(
            value.flatMap((element) =>
              describeShape({ value: element, path: `${path}[]` }),
            ),
          ),
        ];
  if (!isRecord(value)) return [`${path}: ${typeName(value)}`];
  const entries = Object.entries(value);
  return entries.length === 0
    ? [`${path}: object (empty)`]
    : [
        ...new Set(
          entries.flatMap(([key, child]) =>
            describeShape({
              value: child,
              path: path ? `${path}.${shapeKey(key)}` : shapeKey(key),
            }),
          ),
        ),
      ];
}

function scrubbedEnv(env: Env): Env {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        !key.startsWith("PLANNER_") && !/_(TOKEN|SECRET|PASSWORD)$/.test(key),
    ),
  );
}

function resolveExecutable(options: { command: string; env: Env }) {
  const command =
    options.command.startsWith("~/") && options.env.HOME
      ? join(options.env.HOME, options.command.slice(2))
      : options.command;
  if (command.includes("/")) return resolve(command);
  return (
    (options.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => resolve(directory, command))
      .find((path) => {
        try {
          accessSync(path, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      }) ?? command
  );
}

function runCommand(options: {
  command: string;
  args: string[];
  env: Env;
}): Promise<CommandResult> {
  return new Promise((settle) => {
    const child = spawn(options.command, options.args, {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let isMissing = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
    }, commandTimeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if ("code" in error && error.code === "ENOENT") isMissing = true;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      settle({ code: isMissing ? 127 : (code ?? 1), stdout, stderr, timedOut });
    });
  });
}

async function fetchJson(options: {
  url: string;
  headers: { [key: string]: string };
}): Promise<FetchResult> {
  try {
    const response = await fetch(options.url, {
      headers: options.headers,
      redirect: "error",
      signal: AbortSignal.timeout(fetchTimeoutMs),
    });
    return {
      kind: "response",
      status: response.status,
      body: parseJson(await response.text()),
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    return {
      kind: "failed",
      reason:
        name === "TimeoutError"
          ? `network timeout after ${fetchTimeoutMs / 1000} s`
          : `network error (${name}${errorCode(error)})`,
    };
  }
}

function failureReason(result: FetchResult) {
  if (result.kind === "failed") return result.reason;
  if (result.status === 401 || result.status === 403)
    return `HTTP ${result.status}: the stored sign-in was refused. This script never refreshes tokens; run the CLI once, then run this again`;
  if (result.status === 429)
    return "HTTP 429: the usage endpoint is rate limiting this account";
  return `HTTP ${result.status}`;
}

function checkReset(options: {
  resetsAtMs: number | undefined;
  windowSeconds: number | undefined;
  nowMs: number;
}) {
  const { resetsAtMs, windowSeconds, nowMs } = options;
  if (resetsAtMs === undefined) return "no reset time";
  if (resetsAtMs < nowMs - clockSlackMs) return "FAIL: reset time is in the past";
  if (windowSeconds === undefined)
    return "after now; not checked against a window length";
  if (windowSeconds > 8 * 24 * hourSeconds)
    return "FAIL: window length is over 8 days";
  return resetsAtMs > nowMs + windowSeconds * 1000 + clockSlackMs
    ? "FAIL: reset time is more than one window length away"
    : "ok (after now, within one window length)";
}

function unavailable(reason: string): Usage {
  return { kind: "unavailable", reason, shape: [], notes: [] };
}

async function readVersion(options: {
  path: string;
  env: Env;
}): Promise<VersionRead> {
  const version = await runCommand({
    command: options.path,
    args: ["--version"],
    env: options.env,
  });
  if (version.code === 127) return { kind: "failed", reason: "not installed" };
  if (version.timedOut)
    return { kind: "failed", reason: "--version timed out" };
  if (version.code !== 0)
    return { kind: "failed", reason: `--version exited ${version.code}` };
  const text = version.stdout.trim().split("\n").at(0) ?? "";
  return { kind: "found", text };
}

async function readClaudeCredentials(env: Env): Promise<ClaudeCredentials> {
  const keychain =
    process.platform === "darwin" && !env.CLAUDE_CONFIG_DIR
      ? await runCommand({
          command: "security",
          args: ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
          env,
        })
      : undefined;
  const filePath = join(
    env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? homedir(), ".claude"),
    ".credentials.json",
  );
  const source =
    keychain?.code === 0
      ? { name: "keychain item", text: keychain.stdout.trim() }
      : existsSync(filePath)
        ? { name: ".credentials.json", text: readTextFile(filePath) ?? "" }
        : undefined;
  if (!source)
    return {
      kind: "missing",
      reason: `no stored credentials (keychain ${keychain?.timedOut ? "read timed out" : keychain ? `exit ${keychain.code}` : "not read"}, no .credentials.json)`,
    };
  const raw = parseJson(source.text);
  if (!isRecord(raw))
    return { kind: "missing", reason: `${source.name} payload was not JSON` };
  const oauth = raw.claudeAiOauth;
  const accessToken = isRecord(oauth)
    ? stringOrUndefined(oauth.accessToken)
    : undefined;
  if (!isRecord(oauth) || !accessToken)
    return {
      kind: "missing",
      reason:
        "no claude.ai OAuth credentials (API-key sign-ins do not report plan limits)",
    };
  if (Array.isArray(oauth.scopes) && !oauth.scopes.includes("user:profile"))
    return {
      kind: "missing",
      reason: "the stored sign-in lacks the user:profile scope",
    };
  return {
    kind: "found",
    accessToken,
    sourceName: source.name,
    hasScopeList: Array.isArray(oauth.scopes),
    plan: shortText(oauth.subscriptionType),
    expiresAtMs:
      typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined,
  };
}

function readClaudeWindow(options: {
  key: string;
  label: string;
  windowSeconds: number;
  value: unknown;
  nowMs: number;
}): WindowRead[] {
  const { key, value } = options;
  if (value === null || value === undefined) return [];
  if (!isRecord(value) || typeof value.utilization !== "number")
    return [
      {
        kind: "problem",
        text: isRecord(value)
          ? `${key}.utilization is ${typeName(value.utilization)}, expected number`
          : `${key} is ${typeName(value)}, expected object`,
      },
    ];
  const resetsAt = value.resets_at;
  if (resetsAt !== null && resetsAt !== undefined && typeof resetsAt !== "string")
    return [
      {
        kind: "problem",
        text: `${key}.resets_at is ${typeName(resetsAt)}, expected string or null`,
      },
    ];
  const parsedMs = typeof resetsAt === "string" ? Date.parse(resetsAt) : undefined;
  const resetsAtMs = Number.isNaN(parsedMs) ? undefined : parsedMs;
  return [
    {
      kind: "window",
      window: {
        label: options.label,
        usedPercent: value.utilization,
        resetsAt:
          resetsAtMs === undefined
            ? undefined
            : new Date(resetsAtMs).toISOString(),
        resetCheck: Number.isNaN(parsedMs)
          ? "FAIL: resets_at is not a date"
          : checkReset({
              resetsAtMs,
              windowSeconds: options.windowSeconds,
              nowMs: options.nowMs,
            }),
      },
    },
  ];
}

function describeLimit(limit: unknown) {
  if (!isRecord(limit)) return [];
  const fields = ["kind", "group", "percent", "severity", "resets_at", "is_active"]
    .filter((field) =>
      ["string", "number", "boolean"].includes(typeof limit[field]),
    )
    .map((field) => `${field}=${String(limit[field]).slice(0, 60)}`);
  const model = isRecord(limit.scope) ? limit.scope.model : undefined;
  const modelName = isRecord(model)
    ? shortText(model.display_name)
    : undefined;
  return [
    `limits[] entry, not read by Studio: ${[...fields, ...(modelName ? [`scope.model.display_name=${modelName}`] : [])].join(" ")}`,
  ];
}

function readClaudeUsage(options: {
  body: unknown;
  userAgent: string;
  notes: string[];
}): Usage {
  const { body, userAgent, notes } = options;
  const shape = describeShape({ value: body, path: "" });
  if (!isRecord(body))
    return {
      kind: "unavailable",
      reason:
        body === undefined
          ? "HTTP 200, but the body was not JSON"
          : `HTTP 200 with a changed shape: body is ${typeName(body)}, expected object`,
      shape,
      notes,
    };
  const nowMs = Date.now();
  const reads = claudeWindows.flatMap((window) =>
    readClaudeWindow({ ...window, value: body[window.key], nowMs }),
  );
  const problems = reads.flatMap((read) =>
    read.kind === "problem" ? [read.text] : [],
  );
  if (problems.length > 0)
    return {
      kind: "unavailable",
      reason: `HTTP 200 with a changed shape: ${problems.join("; ")}`,
      shape,
      notes,
    };
  const missing = ["five_hour", "seven_day"].filter(
    (key) => !Object.hasOwn(body, key),
  );
  const windows = reads.flatMap((read) =>
    read.kind === "window" ? [read.window] : [],
  );
  const largest = Math.max(0, ...windows.map((window) => window.usedPercent));
  return {
    kind: "available",
    windows,
    userAgent,
    shape,
    notes: [
      ...notes,
      ...(missing.length > 0
        ? [
            `missing from the response: ${missing.join(", ")}; Studio would show no window for each`,
          ]
        : []),
      ...(Array.isArray(body.limits) ? body.limits : []).flatMap(describeLimit),
      ...(windows.length === 0
        ? []
        : [
            largest > 1
              ? `utilization is on a 0–100 scale (largest value ${largest})`
              : "every utilization is 1 or less, so this response cannot tell a 0–1 scale from a 0–100 scale",
          ]),
    ],
  };
}

async function checkClaude(env: Env): Promise<CliReport> {
  const childEnv = scrubbedEnv(env);
  const path = resolveExecutable({
    command: env.PLANNER_CLAUDE_BIN ?? "claude",
    env,
  });
  const version = await readVersion({ path, env: childEnv });
  if (version.kind === "failed")
    return {
      cli: "claude",
      rows: [{ label: "path", value: path }],
      usage: unavailable(version.reason),
    };
  const auth = await runCommand({
    command: path,
    args: ["auth", "status", "--json"],
    env: childEnv,
  });
  const status = parseJson(auth.stdout);
  const fields = isRecord(status) ? status : {};
  const isSignedIn = auth.code === 0 && fields.loggedIn === true;
  const baseRows = [
    { label: "path", value: path },
    { label: "version", value: version.text },
    {
      label: "sign-in",
      value: auth.timedOut
        ? "unknown (auth status timed out)"
        : isSignedIn
          ? `signed in (${shortText(fields.authMethod) ?? "method not reported"})`
          : "not signed in",
    },
  ];
  if (!isSignedIn)
    return {
      cli: "claude",
      rows: baseRows,
      usage: unavailable(
        auth.timedOut
          ? "sign-in check timed out"
          : "not signed in (run claude auth login)",
      ),
    };
  const credentials = await readClaudeCredentials(env);
  const statusPlan = shortText(fields.subscriptionType);
  const storedPlan =
    credentials.kind === "found" ? credentials.plan : undefined;
  const rows = [
    ...baseRows,
    {
      label: "plan",
      value: [
        `${statusPlan ?? "not reported"} (auth status)`,
        `${storedPlan ?? "not reported"} (stored credentials)`,
        statusPlan === undefined || storedPlan === undefined
          ? "cannot compare"
          : statusPlan === storedPlan
            ? "they agree"
            : "they differ",
        `planTier ${shortText(fields.planTier) ?? "not reported"}`,
      ].join(" · "),
    },
  ];
  if (credentials.kind === "missing")
    return { cli: "claude", rows, usage: unavailable(credentials.reason) };
  const isExpired =
    credentials.expiresAtMs !== undefined &&
    credentials.expiresAtMs < Date.now();
  const credentialRows = [
    ...rows,
    {
      label: "credentials",
      value: [
        `read from ${credentials.sourceName}`,
        credentials.hasScopeList
          ? "scopes include user:profile"
          : "no scopes list stored",
        credentials.expiresAtMs === undefined
          ? "no expiry time stored"
          : isExpired
            ? "access token past its expiry time"
            : "access token not past its expiry time",
      ].join(" · "),
    },
  ];
  const result = await fetchJson({
    url: "https://api.anthropic.com/api/oauth/usage",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: "application/json",
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": claudeUserAgent,
    },
  });
  const notes = isExpired
    ? ["the stored access token is past its expiry time and was not refreshed"]
    : [];
  if (result.kind === "failed" || result.status !== 200)
    return {
      cli: "claude",
      rows: credentialRows,
      usage: {
        kind: "unavailable",
        reason: failureReason(result),
        shape: [],
        notes,
      },
    };
  return {
    cli: "claude",
    rows: credentialRows,
    usage: readClaudeUsage({
      body: result.body,
      userAgent: claudeUserAgent,
      notes,
    }),
  };
}

function codexWindowLabel(options: {
  seconds: number | undefined;
  fallback: string;
}) {
  const { seconds, fallback } = options;
  if (seconds === undefined) return fallback;
  if (seconds >= 6 * 24 * hourSeconds) return "Weekly";
  const hours = Math.round(seconds / hourSeconds);
  return hours >= 1 ? `${hours}-hour` : `${Math.round(seconds / 60)}-minute`;
}

function readCodexWindow(options: {
  key: string;
  value: unknown;
  fallback: string;
  nowMs: number;
}): WindowRead[] {
  const { key, value, fallback, nowMs } = options;
  if (value === null || value === undefined) return [];
  if (!isRecord(value))
    return [
      { kind: "problem", text: `rate_limit.${key} is ${typeName(value)}` },
    ];
  const problems = [
    typeof value.used_percent === "number"
      ? undefined
      : `rate_limit.${key}.used_percent is ${typeName(value.used_percent)}, expected number`,
    ...["limit_window_seconds", "reset_at"].map((field) =>
      value[field] === undefined || typeof value[field] === "number"
        ? undefined
        : `rate_limit.${key}.${field} is ${typeName(value[field])}, expected number`,
    ),
  ].filter((problem) => problem !== undefined);
  if (problems.length > 0 || typeof value.used_percent !== "number")
    return problems.map((text) => ({ kind: "problem", text }));
  const seconds =
    typeof value.limit_window_seconds === "number"
      ? value.limit_window_seconds
      : undefined;
  const resetsAtMs =
    typeof value.reset_at === "number" ? value.reset_at * 1000 : undefined;
  const resetCheck = checkReset({ resetsAtMs, windowSeconds: seconds, nowMs });
  return [
    {
      kind: "window",
      window: {
        label: `${codexWindowLabel({ seconds, fallback })} (${seconds === undefined ? "no window length" : `${seconds} s window`})`,
        usedPercent: value.used_percent,
        resetsAt:
          resetsAtMs !== undefined && Math.abs(resetsAtMs) <= 8.64e15
            ? new Date(resetsAtMs).toISOString()
            : undefined,
        resetCheck,
      },
    },
  ];
}

function readCodexUsage(options: {
  body: unknown;
  userAgent: string;
  notes: string[];
}): { usage: Usage; plan: string | undefined } {
  const { body, userAgent, notes } = options;
  const shape = describeShape({ value: body, path: "" });
  const changed = (
    detail: string,
  ): { usage: Usage; plan: string | undefined } => ({
    plan: undefined,
    usage: {
      kind: "unavailable",
      reason: `HTTP 200 with a changed shape: ${detail}`,
      shape,
      notes,
    },
  });
  if (!isRecord(body))
    return changed(
      body === undefined
        ? "the body was not JSON"
        : `body is ${typeName(body)}, expected object`,
    );
  const rateLimit = body.rate_limit;
  if (rateLimit !== null && rateLimit !== undefined && !isRecord(rateLimit))
    return changed(`rate_limit is ${typeName(rateLimit)}`);
  if (body.plan_type !== undefined && typeof body.plan_type !== "string")
    return changed(`plan_type is ${typeName(body.plan_type)}, expected string`);
  const nowMs = Date.now();
  const reads = rateLimit
    ? [
        ...readCodexWindow({
          key: "primary_window",
          value: rateLimit.primary_window,
          fallback: "Session",
          nowMs,
        }),
        ...readCodexWindow({
          key: "secondary_window",
          value: rateLimit.secondary_window,
          fallback: "Weekly",
          nowMs,
        }),
      ]
    : [];
  const problems = reads.flatMap((read) =>
    read.kind === "problem" ? [read.text] : [],
  );
  if (problems.length > 0) return changed(problems.join("; "));
  return {
    plan: shortText(body.plan_type),
    usage: {
      kind: "available",
      windows: reads.flatMap((read) =>
        read.kind === "window" ? [read.window] : [],
      ),
      userAgent,
      shape,
      notes: rateLimit
        ? notes
        : [
            ...notes,
            "rate_limit is null or missing; Studio would show no windows",
          ],
    },
  };
}

async function checkCodex(env: Env): Promise<CliReport> {
  const childEnv = scrubbedEnv(env);
  const path = resolveExecutable({
    command: env.PLANNER_CODEX_BIN ?? "codex",
    env,
  });
  const version = await readVersion({ path, env: childEnv });
  if (version.kind === "failed")
    return {
      cli: "codex",
      rows: [{ label: "path", value: path }],
      usage: unavailable(version.reason),
    };
  const help = await runCommand({
    command: path,
    args: ["exec", "--help"],
    env: childEnv,
  });
  const missingFlags = [
    "--ignore-user-config",
    "--dangerously-bypass-hook-trust",
  ].filter((flag) => help.code !== 0 || !help.stdout.includes(flag));
  const auth = await runCommand({
    command: path,
    args: ["login", "status"],
    env: childEnv,
  });
  const loginText = /^Logged in using (\S.*)$/im
    .exec(`${auth.stdout}\n${auth.stderr}`)
    ?.at(1);
  const isSignedIn = auth.code === 0 && loginText !== undefined;
  const method = /chatgpt/i.test(loginText ?? "")
    ? "ChatGPT"
    : /api key/i.test(loginText ?? "")
      ? "API key"
      : "other method";
  const baseRows = [
    { label: "path", value: path },
    { label: "version", value: version.text },
    {
      label: "exec flags",
      value:
        missingFlags.length === 0
          ? "--ignore-user-config and --dangerously-bypass-hook-trust present"
          : `missing ${missingFlags.join(", ")}`,
    },
    {
      label: "sign-in",
      value: auth.timedOut
        ? "unknown (login status timed out)"
        : isSignedIn
          ? `signed in (${method})`
          : "not signed in",
    },
  ];
  const stop = (options: { reason: string; notes: string[] }): CliReport => ({
    cli: "codex",
    rows: [...baseRows, { label: "plan", value: "not reported" }],
    usage: { kind: "unavailable", ...options, shape: [] },
  });
  if (!isSignedIn)
    return stop({
      reason: auth.timedOut
        ? "sign-in check timed out"
        : "not signed in (run codex login)",
      notes: [],
    });
  const authPath = join(
    env.CODEX_HOME ?? join(env.HOME ?? homedir(), ".codex"),
    "auth.json",
  );
  const stored = existsSync(authPath)
    ? parseJson(readTextFile(authPath) ?? "")
    : undefined;
  const tokens = isRecord(stored) ? stored.tokens : undefined;
  const accessToken = isRecord(tokens)
    ? stringOrUndefined(tokens.access_token)
    : undefined;
  if (!isRecord(tokens) || !accessToken)
    return stop({
      reason:
        "no ChatGPT tokens in auth.json (API-key sign-ins do not report plan limits)",
      notes: [],
    });
  const accountId = stringOrUndefined(tokens.account_id);
  const credentialRow = {
    label: "credentials",
    value: `read from auth.json · account id ${accountId ? "present" : "absent"}`,
  };
  const result = await fetchJson({
    url: "https://chatgpt.com/backend-api/wham/usage",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": codexUserAgent,
      ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
    },
  });
  if (result.kind === "failed" || result.status !== 200)
    return {
      cli: "codex",
      rows: [...baseRows, credentialRow, { label: "plan", value: "not reported" }],
      usage: {
        kind: "unavailable",
        reason: failureReason(result),
        shape: [],
        notes: [],
      },
    };
  const read = readCodexUsage({
    body: result.body,
    userAgent: codexUserAgent,
    notes: [],
  });
  return {
    cli: "codex",
    rows: [
      ...baseRows,
      credentialRow,
      {
        label: "plan",
        value: `${read.plan ?? "not reported"} (usage response plan_type)`,
      },
    ],
    usage: read.usage,
  };
}

function formatReport(report: CliReport) {
  const { usage } = report;
  const row = (options: Row) =>
    `  ${options.label.padEnd(13)}${options.value}`;
  return [
    report.cli,
    ...report.rows.map(row),
    ...(usage.kind === "available"
      ? [
          row({
            label: "usage",
            value: `answered with User-Agent ${usage.userAgent}, ${usage.windows.length} windows`,
          }),
          ...usage.windows.map(
            (window) =>
              `    ${window.label.padEnd(34)}${`${window.usedPercent.toFixed(1)}%`.padStart(6)}  resets ${window.resetsAt ?? "not reported"}  reset check: ${window.resetCheck}`,
          ),
        ]
      : [row({ label: "usage", value: `unavailable: ${usage.reason}` })]),
    ...usage.notes.map((note) => row({ label: "note", value: note })),
    ...(usage.shape.length > 0
      ? [
          "  response shape (key paths and types, no values)",
          ...usage.shape.map((line) => `    ${line}`),
        ]
      : []),
  ]
    .map((line) => line.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?"))
    .join("\n");
}

function failedReport(cli: CliReport["cli"]) {
  return (error: unknown): CliReport => ({
    cli,
    rows: [],
    usage: unavailable(
      `check failed (${error instanceof Error ? error.name : "unknown error"}${errorCode(error)})`,
    ),
  });
}

function reportText(options: {
  cli: CliReport["cli"];
  check: Promise<CliReport>;
}) {
  return options.check.catch(failedReport(options.cli)).then(formatReport);
}

const texts = await Promise.all([
  reportText({ cli: "claude", check: checkClaude(process.env) }),
  reportText({ cli: "codex", check: checkCodex(process.env) }),
]);
console.log(texts.join("\n\n"));
