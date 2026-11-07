/**
 * map-layers: fetch the georeferenced map scans a site's historical map layer
 * needs into the site's own folder, so the site works offline afterwards.
 *
 * Runs in the `process` hook. The layer tables come from the site config
 * (`context.site_config.map.layers`).
 */

import type { ProcessContext, HookResult } from "@symbiosis-lab/moss-api";
import { downloadAsset, fileExists, httpGet, readFile, writeFile } from "@symbiosis-lab/moss-api";
import { parseLayers, summary, syncLayers, type Io } from "./fetcher";

const USER_AGENT = "moss/map-layers (+https://github.com/Symbiosis-Lab/moss)";

export const io: Io = {
  async get(url) {
    const r = await httpGet(url, { headers: { "User-Agent": USER_AGENT }, timeoutMs: 60000 });
    return { status: r.status, ok: r.ok, text: r.text() };
  },
  async download(url, dir, filename) {
    const r = await downloadAsset(url, dir, { filename, timeoutMs: 180000, headers: { "User-Agent": USER_AGENT } });
    return { status: r.status, ok: r.ok, bytes: r.bytesWritten };
  },
  async read(path) {
    return (await fileExists(path)) ? readFile(path) : null;
  },
  exists: fileExists,
  write: writeFile,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  today: () => new Date().toISOString().slice(0, 10),
  log: (m) => console.log(m),
};

export async function process(context: ProcessContext): Promise<HookResult> {
  const layers = parseLayers((context.site_config?.map as { layers?: unknown } | undefined)?.layers);
  if (!layers.length) return { success: true };
  const line = summary(await syncLayers(io, layers));
  console.log(line);
  // A plate that fails to fetch must not stop the build: the warper notes it.
  return { success: true, message: line };
}
