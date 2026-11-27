import { rm } from "node:fs/promises";

/** Remove the temporary planner folders the e2e run created. */
export default async function globalTeardown() {
  const home = process.env.PLANNER_E2E_HOME;
  if (home !== undefined) await rm(home, { recursive: true, force: true });
}
