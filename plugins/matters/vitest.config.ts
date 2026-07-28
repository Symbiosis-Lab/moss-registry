import os from "node:os";
import { createSocialPluginConfig } from "../vitest.shared.ts";

export default createSocialPluginConfig(import.meta.dirname, {
  coverageExclude: ["src/**/*.test.ts", "src/__generated__/**"],
  // Cap fork-worker heap to prevent the orphan swap-storm (2026-06-14):
  // main.ts is large; loading syndication-toast-law.test.ts in the same
  // worker after main.test.ts OOMs without a cap.
  poolOptions: {
    forks: {
      execArgv: ["--max-old-space-size=3072"],
      maxForks: Math.min(8, os.availableParallelism()),
    },
  },
  extraProjects: [
    {
      extends: true,
      test: {
        name: "features",
        include: ["features/steps/**/*.steps.ts"],
        environment: "node",
        testTimeout: 120000,
        hookTimeout: 60000,
        globals: true,
        setupFiles: ["./test-setup/e2e.ts"],
      },
    },
    {
      extends: true,
      test: {
        name: "e2e",
        include: ["e2e/**/*.test.ts"],
        environment: "node",
        testTimeout: 120000,
        hookTimeout: 60000,
      },
    },
  ],
});
