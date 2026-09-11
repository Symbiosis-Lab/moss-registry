import { createSocialPluginConfig } from "../vitest.shared.ts";

// Only projects with suites on disk are declared (unit + integration).
// features/ (BDD) and e2e/ blocks can be added the way github/ declares them,
// in the same change that adds those directories.
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
  ],
});
