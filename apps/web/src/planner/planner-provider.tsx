"use client";

import { type ReactNode, useEffect, useState } from "react";
import { getDaemonUrl } from "../daemon-http/get-daemon-url.ts";
import { createPlannerSession } from "../ws/create-planner-session.ts";
import { PlannerSessionContext } from "./planner-session-context.ts";

type PlannerProviderProps = { children: ReactNode };

export function PlannerProvider(props: PlannerProviderProps) {
  const [session] = useState(() =>
    createPlannerSession({
      url: getDaemonUrl({ path: "/ws", protocol: "ws" }),
      createSocket: (url) => new WebSocket(url),
    }),
  );

  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);

  return (
    <PlannerSessionContext value={session}>
      {props.children}
    </PlannerSessionContext>
  );
}
