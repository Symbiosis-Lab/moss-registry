/**
 * Runtime state — the plugin's own bookkeeping, in
 * `.moss/plugins/ipfs/state.json`.
 *
 * Kept strictly apart from settings (settings.ts): the user's config.json is
 * theirs and moss's, and a deploy must never edit it. Everything here is
 * written by the plugin and read by nobody else.
 *
 * `ipnsSeq` is the reason this file must survive: an IPNS record whose
 * sequence does not exceed the last published one is rejected by every node,
 * so a lost sequence silently freezes the site's stable address. Hence the
 * one-time migration below out of the legacy config.json, where earlier
 * versions of this plugin stored it.
 */

import {
  readPluginFile,
  writePluginFile,
  pluginFileExists,
} from "@symbiosis-lab/moss-api";
import type { IpfsState } from "./types";

const STATE_FILE = "state.json";
/** Where releases before the settings/state split kept this data. */
const LEGACY_FILE = "config.json";

/** The keys the legacy config.json may hold that are really state. */
const STATE_KEYS = [
  "ipnsSeq",
  "ipnsName",
  "lastCid",
  "lastUsedIpns",
  "structureVerified",
  "lastDeployError",
] as const;

async function readJson(name: string): Promise<Record<string, unknown> | null> {
  try {
    if (!(await pluginFileExists(name))) return null;
    const parsed = JSON.parse(await readPluginFile(name)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Keep only recognized state keys — legacy config.json also holds settings. */
function pickState(raw: Record<string, unknown>): IpfsState {
  const out: IpfsState = {};
  for (const key of STATE_KEYS) {
    if (raw[key] !== undefined) (out as Record<string, unknown>)[key] = raw[key];
  }
  // Pre-split releases wrote the identity name under its own key.
  if (out.ipnsName === undefined && typeof raw.identityIpnsName === "string") {
    out.ipnsName = raw.identityIpnsName;
  }
  return out;
}

/**
 * Current state. Falls back to the legacy config.json until the first write,
 * so an upgrade keeps the site's IPNS name and sequence; config.json is never
 * written back.
 */
export async function getState(): Promise<IpfsState> {
  const own = await readJson(STATE_FILE);
  if (own) return pickState(own);
  const legacy = await readJson(LEGACY_FILE);
  return legacy ? pickState(legacy) : {};
}

/** Merge a patch into state and persist it. */
export async function updateState(patch: Partial<IpfsState>): Promise<IpfsState> {
  const next = { ...(await getState()), ...patch };
  await writePluginFile(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

/** Record a successful deploy, clearing any prior error. */
export async function recordSuccess(
  cid: string,
  extra: Partial<IpfsState> = {},
): Promise<void> {
  await updateState({ lastCid: cid, lastDeployError: undefined, ...extra });
}

/** Record why a deploy failed (breadcrumb; cleared on the next success). */
export async function recordError(message: string): Promise<void> {
  await updateState({ lastDeployError: message });
}
