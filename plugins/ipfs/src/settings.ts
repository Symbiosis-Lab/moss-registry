/**
 * Plugin settings — READ-ONLY.
 *
 * moss owns settings. The host already merges the user's
 * `.moss/plugins/ipfs/config.json` over the manifest's declared defaults and
 * hands the result to every hook as `context.config` (snake_case manifest
 * keys). This module only translates that record into the plugin's camelCase
 * shape; it never reads or writes config.json itself.
 *
 * The plugin used to re-implement the merge and write the result back, which
 * baked runtime state into the user's settings file. Runtime bookkeeping now
 * lives in state.ts (state.json) and settings are never written.
 */

import type { IpfsSettings, ProviderId } from "./types";

/**
 * Fallbacks for a hook invoked without the host's merged config (a bare
 * `context.config`). They mirror manifest.json's `config` block; the manifest
 * is the source of truth for what a user sees.
 */
const DEFAULTS: IpfsSettings = {
  provider: "pinata",
  useIpns: true,
  relativeUrls: true,
};

/** `config_schema` only expresses primitives, so coerce `provider` on read. */
function toProvider(value: unknown): ProviderId | undefined {
  return value === "local" || value === "pinata" ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** The plugin's settings for this hook invocation. */
export function readSettings(userConfig?: Record<string, unknown>): IpfsSettings {
  const u = userConfig ?? {};
  return {
    provider: toProvider(u.provider) ?? DEFAULTS.provider,
    gateway: str(u.gateway),
    pinName: str(u.pin_name),
    useIpns: bool(u.use_ipns) ?? DEFAULTS.useIpns,
    relativeUrls: bool(u.relative_urls) ?? DEFAULTS.relativeUrls,
    nodeRpc: str(u.node_rpc),
    coPin: bool(u.co_pin) ?? false,
  };
}
