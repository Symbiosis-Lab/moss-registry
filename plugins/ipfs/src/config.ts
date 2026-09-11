/**
 * Plugin configuration management.
 *
 * Stored in the plugin's private directory (.moss/plugins/ipfs/config.json) via
 * the moss-api plugin storage API — no path handling required. Mirrors
 * matters/src/config.ts.
 *
 * NOTE: the Pinata JWT is a secret and is deliberately NOT stored here — see
 * credentials.ts.
 */

import {
  readPluginFile,
  writePluginFile,
  pluginFileExists,
} from "@symbiosis-lab/moss-api";
import type { IpfsPluginConfig, ProviderId } from "./types";

const CONFIG_FILE = "config.json";

const DEFAULTS: IpfsPluginConfig = {
  provider: "pinata",
  useIpns: true,
  relativeUrls: true,
};

/** `config_schema` only expresses primitives, so coerce `provider` on read. */
function normalizeProvider(value: unknown): ProviderId {
  return value === "local" ? "local" : "pinata";
}

/**
 * Read plugin configuration, merged over defaults.
 * Returns defaults on any error (missing file, parse failure).
 */
export async function getConfig(): Promise<IpfsPluginConfig> {
  try {
    if (!(await pluginFileExists(CONFIG_FILE))) {
      return { ...DEFAULTS };
    }
    const raw = await readPluginFile(CONFIG_FILE);
    const parsed = JSON.parse(raw) as IpfsPluginConfig;
    const merged = { ...DEFAULTS, ...parsed };
    merged.provider = normalizeProvider(merged.provider);
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

/** Persist plugin configuration. */
export async function saveConfig(config: IpfsPluginConfig): Promise<void> {
  await writePluginFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Overlay the user's moss settings (from context.config, which uses the
 * snake_case manifest keys) onto a persisted config (camelCase). User settings
 * win; derived state (ipnsName, uploadModes, …) is preserved from `base`.
 */
export function applyUserSettings(
  base: IpfsPluginConfig,
  userConfig?: Record<string, unknown>,
): IpfsPluginConfig {
  const u = userConfig ?? {};
  // Only overlay the provider when the user value is a valid provider; an
  // invalid/garbage value must NOT silently switch a saved `local` config back
  // to `pinata`.
  const userProvider = u.provider === "pinata" || u.provider === "local" ? u.provider : undefined;
  return {
    ...base,
    provider: userProvider ?? normalizeProvider(base.provider),
    gateway: typeof u.gateway === "string" ? u.gateway : base.gateway,
    pinName: typeof u.pin_name === "string" ? u.pin_name : base.pinName,
    useIpns: typeof u.use_ipns === "boolean" ? u.use_ipns : base.useIpns,
    relativeUrls: typeof u.relative_urls === "boolean" ? u.relative_urls : base.relativeUrls,
    nodeRpc: typeof u.node_rpc === "string" ? u.node_rpc : base.nodeRpc,
    coPin: typeof u.co_pin === "boolean" ? u.co_pin : base.coPin,
  };
}

/** Merge a partial update into the stored config and persist it. */
export async function updateConfig(
  patch: Partial<IpfsPluginConfig>,
): Promise<IpfsPluginConfig> {
  const next = { ...(await getConfig()), ...patch };
  await saveConfig(next);
  return next;
}

/** Record a successful deploy, clearing any prior error. */
export async function recordSuccess(
  cid: string,
  extra: Partial<IpfsPluginConfig> = {},
): Promise<void> {
  await updateConfig({
    lastCid: cid,
    lastDeployError: undefined,
    ...extra,
  });
}

/** Record why a deploy failed (debugging breadcrumb; cleared on next success). */
export async function recordError(message: string): Promise<void> {
  await updateConfig({ lastDeployError: message });
}
