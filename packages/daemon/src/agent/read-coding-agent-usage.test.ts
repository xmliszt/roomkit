import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCodingAgentUsage } from "./read-coding-agent-usage.ts";

const roots: string[] = [];
function createCredentials(options: {
  kind: "claude" | "codex";
  value: unknown;
}) {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp/agent-usage-"));
  roots.push(root);
  const dir = join(root, `.${options.kind}`);
  mkdirSync(dir);
  writeFileSync(
    join(dir, options.kind === "claude" ? ".credentials.json" : "auth.json"),
    JSON.stringify(options.value),
  );
  return { HOME: root };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("coding agent plan usage", () => {
  it("reads Codex credentials from the injected home and maps windows", async () => {
    const env = createCredentials({
      kind: "codex",
      value: {
        tokens: {
          access_token: "obviously-fake-access-token",
          account_id: "fake-account",
        },
      },
    });
    const result = await readCodingAgentUsage({
      kind: "codex",
      env,
      async fetchJson(input) {
        expect(input.headers.Authorization).toBe(
          "Bearer obviously-fake-access-token",
        );
        expect(input.headers["ChatGPT-Account-Id"]).toBe("fake-account");
        return {
          status: 200,
          body: {
            plan_type: "pro",
            rate_limit: {
              primary_window: {
                used_percent: 20,
                limit_window_seconds: 18000,
                reset_at: 1800000000,
              },
              secondary_window: {
                used_percent: 40,
                limit_window_seconds: 604800,
              },
            },
          },
        };
      },
    });
    expect(result.plan).toBe("pro");
    expect(result.windows).toEqual([
      {
        label: "5-hour",
        usedPercent: 20,
        resetsAt: new Date(1800000000000).toISOString(),
      },
      { label: "Weekly", usedPercent: 40, resetsAt: undefined },
    ]);
  });

  it("reads Claude file credentials without querying the host keychain for an isolated home", async () => {
    const env = createCredentials({
      kind: "claude",
      value: {
        claudeAiOauth: {
          accessToken: "obviously-fake-access-token",
          scopes: ["user:profile"],
          subscriptionType: "max",
        },
      },
    });
    const result = await readCodingAgentUsage({
      kind: "claude",
      env,
      platform: "darwin",
      async runCommand() {
        throw new Error("Must not query host keychain");
      },
      async fetchJson(input) {
        expect(input.headers.Authorization).toBe(
          "Bearer obviously-fake-access-token",
        );
        return {
          status: 200,
          body: {
            five_hour: { utilization: 12, resets_at: "2026-11-06T12:00:00Z" },
            seven_day: { utilization: 50, resets_at: null },
          },
        };
      },
    });
    expect(result.plan).toBe("max");
    expect(result.windows).toEqual([
      { label: "5-hour", usedPercent: 12, resetsAt: "2026-11-06T12:00:00Z" },
      { label: "Weekly", usedPercent: 50, resetsAt: undefined },
    ]);
  });

  it("reports refused credentials without exposing the token", async () => {
    const env = createCredentials({
      kind: "codex",
      value: { tokens: { access_token: "obviously-fake-access-token" } },
    });
    const result = await readCodingAgentUsage({
      kind: "codex",
      env,
      async fetchJson() {
        return { status: 401, body: {} };
      },
    });
    expect(result.error?.kind).toBe("refused");
    expect(result.error?.message).toContain("sign-in was refused");
    expect(JSON.stringify(result)).not.toContain("obviously-fake-access-token");
  });

  it("does not expose fetch exception details that may contain credentials", async () => {
    const env = createCredentials({
      kind: "codex",
      value: { tokens: { access_token: "obviously-fake-access-token" } },
    });
    const result = await readCodingAgentUsage({
      kind: "codex",
      env,
      async fetchJson() {
        throw new Error("obviously-fake-access-token");
      },
    });
    expect(result).toMatchObject({
      windows: [],
      error: { kind: "failed", message: "Usage check failed." },
    });
  });

  it("reads every Claude window from limits[] and labels scoped models", async () => {
    const env = createCredentials({
      kind: "claude",
      value: {
        claudeAiOauth: {
          accessToken: "obviously-fake-access-token",
          scopes: ["user:profile"],
          subscriptionType: "max",
        },
      },
    });
    const result = await readCodingAgentUsage({
      kind: "claude",
      env,
      plan: "team",
      async fetchJson() {
        return {
          status: 200,
          body: {
            limits: [
              {
                kind: "session",
                percent: 49,
                resets_at: "2026-11-22T15:00:00+00:00",
                is_active: false,
              },
              {
                kind: "weekly_all",
                percent: 62,
                resets_at: "2026-11-27T00:00:00+00:00",
                is_active: true,
              },
              {
                kind: "weekly_scoped",
                percent: 54,
                resets_at: null,
                scope: { model: { display_name: "Fable" } },
                is_active: false,
              },
              { kind: "monthly_new", percent: 3 },
            ],
            five_hour: {
              utilization: 49,
              resets_at: "2026-11-22T15:00:00+00:00",
            },
          },
        };
      },
    });
    expect(result.plan).toBe("team");
    expect(result.windows).toStrictEqual([
      {
        label: "5-hour",
        usedPercent: 49,
        resetsAt: "2026-11-22T15:00:00+00:00",
      },
      {
        label: "Weekly",
        usedPercent: 62,
        resetsAt: "2026-11-27T00:00:00+00:00",
      },
      { label: "Weekly · Fable", usedPercent: 54 },
      { label: "monthly_new", usedPercent: 3 },
    ]);
  });

  it.each([
    { response: { status: 429, body: {} }, kind: "rate-limited" },
    { response: { status: 500, body: {} }, kind: "http-status" },
    {
      response: { status: 200, body: { rate_limit: "changed" } },
      kind: "changed-shape",
    },
  ])("reports a $kind failure apart", async ({ response, kind }) => {
    const env = createCredentials({
      kind: "codex",
      value: { tokens: { access_token: "obviously-fake-access-token" } },
    });
    const result = await readCodingAgentUsage({
      kind: "codex",
      env,
      async fetchJson() {
        return response;
      },
    });
    expect(result.error?.kind).toBe(kind);
  });

  it("reports a timed-out request as a timeout", async () => {
    const env = createCredentials({
      kind: "codex",
      value: { tokens: { access_token: "obviously-fake-access-token" } },
    });
    const result = await readCodingAgentUsage({
      kind: "codex",
      env,
      async fetchJson() {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    });
    expect(result.error?.kind).toBe("timeout");
  });

  it("keeps the plan from auth status when usage fails", async () => {
    const env = createCredentials({
      kind: "claude",
      value: {
        claudeAiOauth: {
          accessToken: "obviously-fake-access-token",
          scopes: ["user:profile"],
        },
      },
    });
    const result = await readCodingAgentUsage({
      kind: "claude",
      env,
      plan: "team",
      async fetchJson() {
        return { status: 429, body: {} };
      },
    });
    expect(result).toMatchObject({
      plan: "team",
      error: { kind: "rate-limited" },
    });
  });

  it("falls back to the fixed Claude keys when limits[] is empty", async () => {
    const env = createCredentials({
      kind: "claude",
      value: { claudeAiOauth: { accessToken: "obviously-fake-access-token" } },
    });
    const result = await readCodingAgentUsage({
      kind: "claude",
      env,
      async fetchJson() {
        return {
          status: 200,
          body: { limits: [], five_hour: { utilization: 40 } },
        };
      },
    });
    expect(result.windows).toStrictEqual([
      { label: "5-hour", usedPercent: 40 },
    ]);
  });

  it.each([
    { kind: "claude" as const, body: { future_limits: [] } },
    { kind: "codex" as const, body: {} },
  ])(
    "reports a $kind body with no known usage key as a changed shape",
    async (input) => {
      const env = createCredentials({
        kind: input.kind,
        value:
          input.kind === "claude"
            ? { claudeAiOauth: { accessToken: "obviously-fake-access-token" } }
            : { tokens: { access_token: "obviously-fake-access-token" } },
      });
      const result = await readCodingAgentUsage({
        kind: input.kind,
        env,
        async fetchJson() {
          return { status: 200, body: input.body };
        },
      });
      expect(result.error?.kind).toBe("changed-shape");
    },
  );
});
