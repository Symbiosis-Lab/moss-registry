/**
 * Plugin configuration management
 *
 * Uses the moss-api plugin storage API to automatically store config
 * in the plugin's private directory (.moss/plugins/{plugin-name}/).
 * No need to know the path - just call readPluginFile("config.json").
 */

import {
  readPluginFile,
  writePluginFile,
  pluginFileExists,
} from "@symbiosis-lab/moss-api";

// ============================================================================
// Types
// ============================================================================

/**
 * Plugin configuration stored in config.json
 */
export interface MattersPluginConfig {
  /** Matters username this project is bound to (guards auto-sync) */
  boundUserName?: string;
  /** Matters.town username (allows unauthenticated mode when cookie unavailable) */
  userName?: string;
  /** User's language preference (e.g., "zh_hans", "zh_hant", "en") */
  language?: string;
  /** ISO timestamp of last successful sync completion (for incremental sync) */
  lastSyncedAt?: string;
  /**
   * Human-readable reason the last sync FAILED, persisted so the settings panel
   * can surface it even if it was closed when the (often background) sync failed.
   * Set on the process-hook failure branches; cleared on the next success.
   */
  lastSyncError?: string;
  /** ISO timestamp when `lastSyncError` was recorded. */
  lastSyncErrorAt?: string;
  /** Explicit article folder name override (auto-detected if not set) */
  articleFolder?: string;
  /** Override Matters domain (default: "matters.town", test: "matters.icu") */
  domain?: string;
  /** Known collection IDs from previous syncs (collections lack createdAt, so we track IDs to detect new ones) */
  knownCollectionIds?: string[];
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Read plugin configuration from storage
 *
 * Config is automatically stored in the plugin's private directory.
 * Must be called from within a plugin hook.
 *
 * @returns Plugin configuration object (empty object if not found or invalid)
 */
export async function getConfig(): Promise<MattersPluginConfig> {
  try {
    const exists = await pluginFileExists("config.json");
    if (!exists) {
      return {};
    }

    const content = await readPluginFile("config.json");
    return JSON.parse(content) as MattersPluginConfig;
  } catch {
    // Return empty config on any error (file not found, parse error, etc.)
    return {};
  }
}

/**
 * Save plugin configuration to storage
 *
 * Config is automatically stored in the plugin's private directory.
 * Must be called from within a plugin hook.
 *
 * @param config - Configuration object to save
 * @throws Error if write fails
 */
export async function saveConfig(config: MattersPluginConfig): Promise<void> {
  const content = JSON.stringify(config, null, 2);
  await writePluginFile("config.json", content);
}
