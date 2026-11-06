import { createSocialPluginConfig } from "../vitest.shared.ts";

export default createSocialPluginConfig(import.meta.dirname, {
  unitInclude: ["src/__tests__/*.test.ts"],
  unitEnvironment: "node",
  unitGlobals: true,
});
