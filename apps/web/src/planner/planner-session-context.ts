import { createContext } from "react";
import type { createPlannerSession } from "../ws/create-planner-session.ts";

export const PlannerSessionContext = createContext<
  ReturnType<typeof createPlannerSession> | undefined
>(undefined);
