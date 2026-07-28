import { createSocialPluginConfig } from "../vitest.shared.ts";

export default createSocialPluginConfig(import.meta.dirname, {
  coverageExclude: ["src/**/*.test.ts", "src/__tests__/**", "src/types.ts"],
  unitInclude: ["src/__tests__/*.test.ts"],
  unitExclude: ["src/__tests__/*.integration.test.ts"],
  unitEnvironment: "node",
  unitGlobals: true,
  extraProjects: [
    {
      extends: true,
      test: {
        name: "integration",
        include: ["src/__tests__/*.integration.test.ts"],
        environment: "happy-dom",
        globals: true,
        testTimeout: 30000,
      },
    },
    {
      extends: true,
      test: {
        name: "features",
        include: ["features/steps/**/*.steps.ts"],
        environment: "happy-dom",
        testTimeout: 60000,
        hookTimeout: 30000,
        globals: true,
      },
    },
    // E2E tests require a built moss binary and run in the dedicated E2E workflow.
    // They are excluded from `test:coverage` to avoid failing in the plugin CI job.
    // Run them explicitly via: vitest run --project e2e
    ...(process.env.INCLUDE_E2E
      ? [
          {
            extends: true,
            test: {
              name: "e2e",
              include: ["e2e/**/*.test.ts"],
              environment: "node",
              testTimeout: 60000,
              hookTimeout: 30000,
              globals: true,
            },
          },
        ]
      : []),
  ],
});
