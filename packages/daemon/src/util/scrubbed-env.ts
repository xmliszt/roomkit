const mcpKeys = new Set([
  "PLANNER_PROJECT",
  "PLANNER_PROJECT_ID",
  "PLANNER_TURN",
  "PLANNER_ROLE",
  "PLANNER_FAKE_SCENARIO",
  "PLANNER_READ_ONLY",
  "PLANNER_TOOL_ALLOWLIST",
  "PLANNER_WRITE_ROOT",
  "PLANNER_READ_ROOT",
  "PLANNER_SESSION",
  "PLANNER_TOKEN",
  "PLANNER_WS_URL",
  "PLANNER_HOME",
]);

export function scrubbedEnv(
  options: { env?: NodeJS.ProcessEnv; extra?: NodeJS.ProcessEnv } = {},
) {
  return Object.fromEntries(
    Object.entries({
      ...(options.env ?? process.env),
      ...options.extra,
    }).filter(
      ([key]) =>
        mcpKeys.has(key) ||
        (!key.startsWith("PLANNER_") &&
          !key.startsWith("STUDIO_") &&
          !key.startsWith("LAIOS_") &&
          !/_(TOKEN|SECRET|PASSWORD|API_KEY)$/.test(key)),
    ),
  );
}
