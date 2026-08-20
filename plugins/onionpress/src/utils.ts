/**
 * Utility functions for the OnionPress Deployer Plugin.
 *
 * Thin wrappers over the moss-api SDK that stamp this plugin's message context,
 * mirroring the github plugin's utils module.
 */

import {
  setMessageContext,
  reportProgress as sdkReportProgress,
  reportError as sdkReportError,
} from "@symbiosis-lab/moss-api";

// ============================================================================
// Plugin Configuration
// ============================================================================

const PLUGIN_NAME = "onionpress";

// Initialize message context on load
setMessageContext(PLUGIN_NAME, "deploy");

// ============================================================================
// Re-exports from SDK (with plugin context)
// ============================================================================

/** Set the current hook name for message routing. */
export function setCurrentHookName(name: string): void {
  setMessageContext(PLUGIN_NAME, name);
}

/** Report progress to moss during long-running operations. */
export async function reportProgress(
  phase: string,
  current: number,
  total: number,
  message?: string,
): Promise<void> {
  await sdkReportProgress(phase, current, total, message);
}

/** Report an error to moss during hook execution. */
export async function reportError(
  error: string,
  context?: string,
  fatal = false,
): Promise<void> {
  await sdkReportError(error, context, fatal);
}

// No showToast wrapper, deliberately: this plugin's outcome UX travels as data
// in `HookResult.toast`, never as an imperative SDK call. See main.ts.
