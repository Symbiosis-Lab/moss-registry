/**
 * terrarium — moss advisory-window review harness (dev/test).
 *
 * On folder open the preview runs `PluginMode::NonBlocking`, which fires the
 * `process` hook exactly once; edit-rebuilds run `SlotsOnly` (process skipped).
 * So terrarium opens its gallery on open and not on edits, no guard needed.
 *
 * terrarium processes no content: `process` opens the action-panel gallery and
 * returns a passthrough success.
 */

import type { ProcessContext, HookResult } from "@symbiosis-lab/moss-api";
import { openBrowserWithHtml } from "@symbiosis-lab/moss-api";
import { WINDOWS } from "./windows";
import { renderGallery } from "./gallery";

export async function process(_context: ProcessContext): Promise<HookResult> {
  try {
    await openBrowserWithHtml(renderGallery(WINDOWS));
  } catch (e) {
    console.error("[terrarium] failed to open gallery:", e);
  }
  // Passthrough: terrarium changes no content, so the build proceeds normally.
  return { success: true };
}
