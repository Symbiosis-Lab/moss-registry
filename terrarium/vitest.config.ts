import { defineConfig } from "vitest/config";

// terrarium's units (windows.ts, gallery.ts) are pure — typed catalog data and a
// pure HTML-string renderer. No DOM, no Tauri, no moss-api at test time, so a
// plain node environment is enough (no happy-dom dependency).
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
