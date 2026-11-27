import { expect, test } from "vitest";
import { resolveEnvironment } from "./resolve-environment.ts";

const isolated = {
  PLANNER_HOME: "/tmp/home",
  PLANNER_PROJECTS: "/tmp/projects",
};

test("uses the documented defaults under HOME", () => {
  expect(resolveEnvironment({ HOME: "/Users/someone" })).toStrictEqual({
    allowedHosts: [],
    tailnetLogins: [],
    homeDir: "/Users/someone",
    linkAllowedHosts: [],
    modelRegistryPath: undefined,
    weightsBaseUrl: undefined,
    writeDelayMs: 500,
    plannerHome: "/Users/someone/.interior-planner",
    projectsRoot: "/Users/someone/InteriorPlanner/projects",
    port: 4820,
    webOrigins: ["http://localhost:3210", "http://127.0.0.1:3210"],
  });
});

test("refuses to isolate only one of the two storage folders", () => {
  expect(() => resolveEnvironment({ PLANNER_HOME: "/tmp/home" })).toThrowError(
    "Set both PLANNER_HOME and PLANNER_PROJECTS",
  );
  expect(() =>
    resolveEnvironment({ PLANNER_PROJECTS: "/tmp/projects" }),
  ).toThrowError("Set both PLANNER_HOME and PLANNER_PROJECTS");
});

test("refuses a port, write delay or web origin it cannot use", () => {
  for (const env of [
    { PLANNER_PORT: "" },
    { PLANNER_PORT: "70000" },
    { PLANNER_WRITE_DELAY_MS: "-1" },
    { PLANNER_WRITE_DELAY_MS: "" },
    { PLANNER_WRITE_DELAY_MS: "2147483648" },
    { PLANNER_WEB_ORIGIN: "" },
    { PLANNER_WEB_ORIGIN: "localhost:3210" },
    { PLANNER_WEB_ORIGIN: "http://localhost:3210/" },
    { PLANNER_ALLOWED_HOSTS: "https://tailnet.example:8443" },
    { PLANNER_ALLOWED_HOSTS: "tailnet.example:8443/" },
    { PLANNER_ALLOWED_HOSTS: "tailnet.example:8443@foreign.example" },
    { PLANNER_ALLOWED_HOSTS: "*.example" },
    { PLANNER_ALLOWED_HOSTS: "tailnet.example:65536" },
  ])
    expect(() => resolveEnvironment({ ...isolated, ...env })).toThrowError(
      /^PLANNER_/,
    );
});
