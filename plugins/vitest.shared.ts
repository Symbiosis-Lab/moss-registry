/**
 * Shared vitest config factories for moss plugins.
 *
 * Archive plugins (astro, eleventy, gatsby, hugo, jekyll) and social plugins
 * (douban, substack, xiaohongshu, x, linkedin, etc.) share near-identical
 * vitest configs. These factories eliminate that duplication.
 *
 * Usage (archive unit tests):
 *   import { createArchiveUnitConfig } from "../vitest.shared.ts";
 *   export default createArchiveUnitConfig(import.meta.dirname);
 *
 * Usage (archive e2e tests):
 *   import { createArchiveE2eConfig } from "../../vitest.shared.ts";
 *   export default createArchiveE2eConfig();
 *
 * Usage (social plugin with happy-dom unit tests):
 *   import { createSocialPluginConfig } from "../vitest.shared.ts";
 *   export default createSocialPluginConfig(import.meta.dirname);
 */
import { defineConfig, type UserConfig } from "vitest/config";

/**
 * Create a vitest config for archive plugin unit tests.
 *
 * Provides: node environment, src/**\/*.test.ts include pattern,
 * 60s test timeout, 30s hook timeout, v8 coverage.
 */
export function createArchiveUnitConfig(
  root: string,
  overrides?: Partial<UserConfig["test"]>,
) {
  return defineConfig({
    test: {
      root,
      globals: true,
      environment: "node",
      include: ["src/**/*.test.ts"],
      testTimeout: 60000,
      hookTimeout: 30000,
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "html"],
        exclude: ["node_modules", "dist", "**/*.test.ts", "**/*.e2e.ts"],
      },
      ...overrides,
    },
  });
}

/**
 * Create a vitest config for archive plugin e2e tests.
 *
 * Provides: node environment, src/**\/*.e2e.ts include pattern,
 * 120s test timeout, 60s hook timeout, no coverage.
 */
export function createArchiveE2eConfig(
  overrides?: Partial<UserConfig["test"]>,
) {
  return defineConfig({
    test: {
      globals: true,
      environment: "node",
      include: ["src/**/*.e2e.ts"],
      testTimeout: 120000,
      hookTimeout: 60000,
      ...overrides,
    },
  });
}

/**
 * Create a vitest config for social plugins with a single unit test project.
 *
 * Provides: root, v8 coverage with lcov, a "unit" project using happy-dom.
 * For plugins that need additional projects (e.g., integration, e2e, features),
 * pass them via the extraProjects parameter.
 */
export function createSocialPluginConfig(
  root: string,
  options?: {
    coverageExclude?: string[];
    unitInclude?: string[];
    unitExclude?: string[];
    unitEnvironment?: string;
    unitGlobals?: boolean;
    extraProjects?: Array<Record<string, unknown>>;
    poolOptions?: Record<string, unknown>;
  },
) {
  const {
    coverageExclude = ["src/**/*.test.ts"],
    unitInclude = ["src/**/*.test.ts"],
    unitExclude,
    unitEnvironment = "happy-dom",
    unitGlobals,
    extraProjects = [],
    poolOptions,
  } = options ?? {};

  return defineConfig({
    test: {
      root,
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov", "html"],
        include: ["src/**/*.ts"],
        exclude: coverageExclude,
      },
      ...(poolOptions ? { poolOptions } : {}),
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            include: unitInclude,
            ...(unitExclude ? { exclude: unitExclude } : {}),
            environment: unitEnvironment,
            ...(unitGlobals !== undefined ? { globals: unitGlobals } : {}),
          },
        },
        ...extraProjects,
      ],
    },
  });
}
