import { createContext } from "react";
import type { ShadeGlowRegistry } from "./shade-glow.ts";

export const ShadeGlowRegistryContext = createContext<
  ShadeGlowRegistry | undefined
>(undefined);
