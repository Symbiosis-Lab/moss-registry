/**
 * The publish setup gate's GitHub half (ADR-072).
 *
 * moss asks this before the publish starts, alongside the build, and draws
 * whatever comes back. What it replaces: a sign-in that happened halfway
 * through a deploy, behind a progress bar that said "working" while GitHub
 * waited for a code the user could not see.
 *
 * There is nothing here for moss's credential modal to collect — a device-flow
 * token is issued to the plugin, not typed by the user — so the whole need is
 * one button, and the plugin does the work when it is clicked.
 */

import type { HookResult, SetupContext } from "@symbiosis-lab/moss-api";
import { promptLogin, resolveTokenOutcome } from "./auth";

/** The only action this plugin offers, and the id moss sends back on click. */
const SIGN_IN = "sign_in";

/**
 * Is there a GitHub account behind this publish?
 *
 * A cancelled or failed sign-in returns the same need with the same id, so the
 * modal re-renders one need rather than stacking a second copy.
 */
export async function check_setup(ctx: SetupContext): Promise<HookResult> {
  if (ctx.action === SIGN_IN) {
    await promptLogin();
  }

  // Through the one resolver, so the gate asks exactly what the publish will:
  // the token may live in a credential helper that only moss's own git can
  // reach, and asking the weaker question here would report "sign in" to
  // someone already signed in.
  const { token, unreachable } = await resolveTokenOutcome();
  if (token) {
    return { success: true, setup: { ready: true } };
  }

  if (unreachable) {
    // No sign-in button: the device flow needs the network that just failed,
    // and the stored token may well be fine. Say what happened and stop.
    return {
      success: true,
      setup: {
        ready: false,
        needs: [
          {
            id: "github_account",
            message:
              "moss could not reach GitHub to check your account. " +
              "Check your connection and publish again.",
          },
        ],
      },
    };
  }

  return {
    success: true,
    setup: {
      ready: false,
      needs: [
        {
          id: "github_account",
          message:
            "moss publishes to GitHub Pages as you, so it needs your GitHub account. " +
            "Signing in opens github.com with a code to enter — no password is typed into moss.",
          actions: [{ id: SIGN_IN, label: "Sign in to GitHub" }],
        },
      ],
    },
  };
}
