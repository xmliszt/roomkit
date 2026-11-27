import { createContext } from "react";
import type { ShadowCasters } from "./shadow-casters.ts";

export const ShadowCastersContext = createContext<ShadowCasters>({
  isStale: true,
});
