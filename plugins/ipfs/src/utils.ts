/**
 * Utility functions for the IPFS Deployer Plugin.
 *
 * Thin wrappers over @symbiosis-lab/moss-api that bind the plugin's message
 * context, mirroring github/src/utils.ts.
 */

import {
  setMessageContext,
  reportProgress as sdkReportProgress,
  reportError as sdkReportError,
  showToast as sdkShowToast,
  closeBrowser as sdkCloseBrowser,
  type ToastOptions,
} from "@symbiosis-lab/moss-api";

export type { ToastOptions };

const PLUGIN_NAME = "ipfs";

// Initialize message context on load.
setMessageContext(PLUGIN_NAME, "deploy");

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

/** Show a toast notification in the main moss UI. */
export async function showToast(options: ToastOptions | string): Promise<void> {
  await sdkShowToast(options);
}

/** Close the action panel. */
export async function closeBrowser(): Promise<void> {
  await sdkCloseBrowser();
}

/** Sleep for the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format a byte count as a short human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
