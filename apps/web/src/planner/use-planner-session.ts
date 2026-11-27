import { useContext } from "react";
import { PlannerSessionContext } from "./planner-session-context.ts";

/** Return the session from the nearest `PlannerProvider`; throw when there is none. */
export function usePlannerSession() {
  const session = useContext(PlannerSessionContext);
  if (session === undefined) {
    throw new Error("usePlannerSession needs a PlannerProvider");
  }
  return session;
}
