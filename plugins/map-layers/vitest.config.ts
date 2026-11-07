import { defineConfig } from "vitest/config";

// The units are pure geometry plus a fetcher over an injected IO object, so a
// plain node environment is enough.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/main.ts"],
    },
  },
});
