import { createContext } from "react";
import type { LightEmitterRegistry } from "./light-emitter-registry.ts";

export const LightEmitterRegistryContext = createContext<LightEmitterRegistry>(
  {},
);
