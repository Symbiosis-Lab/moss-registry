/**
 * Permanent-failure memo for media downloads.
 *
 * Persists URLs that returned a non-retryable HTTP error (403, 404, 410, etc.)
 * so subsequent builds can skip them immediately without attempting a network
 * round-trip. The memo is stored as `failed-media.json` in the plugin's private
 * directory (`.moss/plugins/matters/failed-media.json`).
 *
 * This module is the canonical SSOT for the failure list. The frontend settings
 * page (`frontend/app/settings/sections/plugin.ts`) defines a structural copy of
 * `FailedMediaEntry` for its own build context but must remain compatible with
 * the shape defined here.
 */

import { readPluginFile, writePluginFile } from "@symbiosis-lab/moss-api";

// ============================================================================
// Types
// ============================================================================

/** One permanently-failed media download recorded to failed-media.json */
export interface FailedMediaEntry {
  /** Original remote URL that could not be downloaded */
  url: string;
  /** Relative paths of ALL articles that reference this URL */
  filePaths: string[];
  /** ISO 8601 timestamp of when the permanent failure was first recorded */
  failedAt: string;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Load the permanent-failure memo from plugin storage.
 *
 * Returns an empty array when the file is absent or unparseable — never throws.
 * Does NOT call pluginFileExists() first (unneeded round-trip; read-or-empty
 * is the canonical pattern; see config.ts for precedent).
 */
export async function loadFailedMediaMemo(): Promise<FailedMediaEntry[]> {
  try {
    const content = await readPluginFile("failed-media.json");
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as FailedMediaEntry[];
  } catch {
    // File absent, parse error, or IPC failure — all treated as empty memo.
    return [];
  }
}

/**
 * Merge new permanent failures into the memo, deduplicating by URL.
 *
 * A fresh entry for an existing URL overwrites the old one (updates failedAt).
 * Never throws — a memo-write failure is console.warn only and must not abort
 * the calling sync.
 */
export async function mergePermanentFailures(
  newEntries: FailedMediaEntry[]
): Promise<void> {
  if (newEntries.length === 0) return;
  try {
    const existing = await loadFailedMediaMemo();
    const byUrl = new Map<string, FailedMediaEntry>();
    // Load existing entries first so new ones can overwrite
    for (const entry of existing) {
      byUrl.set(entry.url, entry);
    }
    for (const entry of newEntries) {
      byUrl.set(entry.url, entry);
    }
    const merged = Array.from(byUrl.values());
    await writePluginFile("failed-media.json", JSON.stringify(merged, null, 2));
  } catch (err) {
    console.warn("[matters] Failed to write failed-media.json (non-fatal):", err);
  }
}
