import { createSocialPluginConfig } from "../vitest.shared.ts";

export default createSocialPluginConfig(import.meta.dirname, {
  coverageExclude: ["src/**/*.test.ts", "src/__tests__/**", "src/types.ts"],
  unitInclude: ["src/__tests__/*.test.ts"],
  // happy-dom (not node): main.ts registers itself on `window` at import time,
  // exactly like the github plugin. The unit suite needs a real `window` to
  // load main.ts without a ReferenceError.
  unitEnvironment: "happy-dom",
  unitGlobals: true,
});
