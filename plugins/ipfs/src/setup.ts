/**
 * The publish setup gate's IPFS half (ADR-072).
 *
 * moss asks this on the Publish click, alongside the build, and draws whatever
 * comes back. The manifest already answers what a declaration can — Pinata's
 * token is declared under `contributes.deploy_target.setup.credentials`, so
 * moss collects it in its own modal before this hook runs. What is left is
 * what only the plugin can see: whether the user's own IPFS node is running,
 * whether its gateway port is free, and whether the stored token still works.
 * Each backend answers for itself (`IpfsProvider.checkSetup`), so the setup
 * gate and the deploy-time guard can never disagree about the same node.
 *
 * Everything here used to be a panel this plugin drew itself, mid-deploy,
 * behind a progress bar that said "working" while the plugin waited for a
 * person.
 */

import type { HookResult, SetupContext } from "@symbiosis-lab/moss-api";
import { getProvider } from "./providers";
import { readSettings } from "./settings";
import { setCurrentHookName } from "./utils";

export async function check_setup(ctx: SetupContext): Promise<HookResult> {
  setCurrentHookName("check_setup");
  const setup = await getProvider(readSettings(ctx.config)).checkSetup(ctx.action);
  return { success: true, setup };
}
