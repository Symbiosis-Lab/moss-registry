import { describe, it, expect } from "vitest";
import { resolveAuthRoute, isUserPresent } from "../auth-route";

describe("isUserPresent", () => {
  it.each([
    ["onboarding_flow", true],
    ["settings_manual", true],
    ["manual_one", true],
    ["background", false],
    [undefined, false], // older moss: absent ⇒ background, the quiet default
    ["future_unknown_trigger", false], // unknown ⇒ quiet default, never popups
  ] as const)("trigger %s → %s", (trigger, expected) => {
    expect(isUserPresent(trigger)).toBe(expected);
  });
});

describe("resolveAuthRoute", () => {
  // Full table from the design spec §3.3.
  it.each([
    // state      trigger             hasUserName  expected
    ["valid",    "background",        true,        "proceed"],
    ["valid",    "background",        false,       "proceed"],
    ["valid",    "settings_manual",   true,        "proceed"],
    ["valid",    "onboarding_flow",   false,       "proceed"],
    ["expired",  "onboarding_flow",   true,        "prompt_login"],
    ["expired",  "settings_manual",   true,        "prompt_login"],
    ["expired",  "manual_one",        false,       "prompt_login"],
    ["expired",  "background",        true,        "public_fallback"],
    ["expired",  "background",        false,       "soft_fail"],
    ["none",     "settings_manual",   true,        "public_fallback"], // existing behavior preserved
    ["none",     "onboarding_flow",   false,       "prompt_login"],    // existing behavior preserved
    ["none",     "background",        true,        "public_fallback"],
    ["none",     "background",        false,       "soft_fail"],       // was promptLogin: background never popups
    ["expired",  undefined,           true,        "public_fallback"], // absent trigger = background
  ] as const)("(%s, %s, userName=%s) → %s", (state, trigger, hasUserName, expected) => {
    expect(resolveAuthRoute(state, trigger, hasUserName)).toBe(expected);
  });
});
