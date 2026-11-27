import type { loadAppearanceData } from "./load-appearance-data.ts";

export type AppearanceData = Awaited<ReturnType<typeof loadAppearanceData>>;
