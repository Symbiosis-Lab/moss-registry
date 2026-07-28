/**
 * Pure auth-routing decision for the process hook.
 *
 * Inputs: the tri-state session check (api.ts getSessionState), moss's
 * trigger stamp (ADR-015, snake_case; absent ⇒ "background"), and whether a
 * userName is saved in config (enables public-mode import).
 *
 * Invariant: background NEVER opens a login window. A quiet rebuild popping
 * a browser uninvited is the bug class this module exists to kill.
 */

import type { SessionState } from "./credential";

export type AuthRoute = "proceed" | "prompt_login" | "public_fallback" | "soft_fail";

const USER_PRESENT_TRIGGERS = new Set(["onboarding_flow", "settings_manual", "manual_one"]);

/** Unknown or absent triggers count as background (quiet default). */
export function isUserPresent(trigger: string | undefined): boolean {
  return trigger !== undefined && USER_PRESENT_TRIGGERS.has(trigger);
}

export function resolveAuthRoute(
  state: SessionState,
  trigger: string | undefined,
  hasUserName: boolean
): AuthRoute {
  if (state === "valid") return "proceed";

  if (isUserPresent(trigger)) {
    // Expired session + present user: re-login beats a degraded import.
    if (state === "expired") return "prompt_login";
    // Never logged in: keep today's behavior (public fallback when bound).
    return hasUserName ? "public_fallback" : "prompt_login";
  }

  return hasUserName ? "public_fallback" : "soft_fail";
}
