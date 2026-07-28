/**
 * Utility functions for the GitHub Deployer Plugin
 *
 * This module wraps SDK utilities with plugin-specific functionality.
 */

import {
  setMessageContext,
  reportProgress as sdkReportProgress,
  reportError as sdkReportError,
  showToast as sdkShowToast,
  dismissToast as sdkDismissToast,
  closeBrowser as sdkCloseBrowser,
  type ToastOptions,
} from "@symbiosis-lab/moss-api";

// Re-export ToastOptions type for convenience
export type { ToastOptions };

// ============================================================================
// Plugin Configuration
// ============================================================================

const PLUGIN_NAME = "github";

// Initialize message context on load
setMessageContext(PLUGIN_NAME, "deploy");

// ============================================================================
// Re-exports from SDK (with plugin context)
// ============================================================================

/**
 * Set the current hook name for message routing
 */
export function setCurrentHookName(name: string): void {
  setMessageContext(PLUGIN_NAME, name);
}

/**
 * Report progress to moss during long-running operations
 */
export async function reportProgress(
  phase: string,
  current: number,
  total: number,
  message?: string
): Promise<void> {
  await sdkReportProgress(phase, current, total, message);
}

/**
 * Report an error to moss during hook execution
 */
export async function reportError(
  error: string,
  context?: string,
  fatal = false
): Promise<void> {
  await sdkReportError(error, context, fatal);
}

// ============================================================================
// Toast Utilities
// ============================================================================

/**
 * Show a toast notification in the main moss UI
 *
 * @example
 * ```typescript
 * // Success toast with clickable action
 * await showToast({
 *   message: "Deployed!",
 *   variant: "success",
 *   actions: [{ label: "View site", url: "https://..." }],
 *   duration: 8000
 * });
 * ```
 */
export async function showToast(options: ToastOptions | string): Promise<void> {
  await sdkShowToast(options);
}

/**
 * Dismiss a toast by ID
 */
export async function dismissToast(id: string): Promise<void> {
  await sdkDismissToast(id);
}

/**
 * Close the action panel
 */
export async function closeBrowser(): Promise<void> {
  await sdkCloseBrowser();
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
