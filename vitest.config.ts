import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 2,
    testTimeout: 30000,
    hookTimeout: 30000,
    exclude: ["**/node_modules/**", "**/.next/**"],
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: [
            "packages/**/*.test.ts",
            "apps/**/*.test.ts",
            "test/**/*.test.ts",
          ],
          exclude: [
            "**/node_modules/**",
            "**/.next/**",
            "**/use-scene-history.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "react",
          environment: "jsdom",
          include: [
            "apps/web/src/editor/use-scene-history.test.ts",
            "apps/web/src/editor/bottom-left.test.tsx",
          ],
        },
      },
    ],
  },
});
