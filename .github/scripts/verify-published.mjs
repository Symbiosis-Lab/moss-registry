#!/usr/bin/env node
// Post-publish check: re-download every starter asset through the LIVE index
// and compare it with what the index promises.
//
//   node .github/scripts/verify-published.mjs --index-url <url> [--serial N]
//
// build-index.mjs hashes the assets it saw when it built the index; nothing
// afterwards looks at what a client will actually download. A release asset
// that was replaced, deleted or served truncated after indexing makes every
// install of that starter fail its sha256 check on the user's machine. This is
// the only step that reads the index the way a client does.
//
// It runs in its own job after the deploy and only reports: index.json and
// revoked.json are already live, so a red run here can never hold them back.
//
// Deploy propagation lags, so when --serial is given it polls until the live
// index reaches that serial. Lag alone is a warning, not a failure: whatever
// is live is verified either way.
//
// Node builtins only.

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

/** The (label, url, sha256, size) of every starter asset an entry promises. */
export function assetsOf(entry) {
  const where = `${entry.id}@${entry.version}`;
  const problems = [];
  const assets = [];
  const add = (kind, url, sha256, size) => {
    const missing = [];
    if (typeof url !== "string" || !url) missing.push("url");
    if (typeof sha256 !== "string" || !sha256) missing.push("sha256");
    if (!Number.isInteger(size)) missing.push("size");
    if (missing.length) problems.push(`${where} ${kind}: index entry has no ${missing.join(", ")}`);
    else assets.push({ label: `${where} ${kind}`, url, sha256, size });
  };
  add("source", entry.download_url, entry.sha256, entry.size_bytes);
  add("preview", entry.preview_url, entry.preview_sha256, entry.preview_size_bytes);
  // Posters are optional in the index (older releases have none), but an entry
  // that names any poster field must name all three, and they are verified.
  for (const scheme of ["light", "dark"]) {
    const [url, sha256, size] = ["url", "sha256", "size_bytes"].map((f) => entry[`poster_${scheme}_${f}`]);
    if (url !== undefined || sha256 !== undefined || size !== undefined) add(`poster ${scheme}`, url, sha256, size);
  }
  return { assets, problems };
}

/**
 * Download every starter asset and compare. Returns { checked, failures,
 * warnings }; never throws on a bad asset, so one failure cannot hide another.
 * `fetchImpl` and `sleep` are injectable for tests.
 */
export async function verifyPublished({
  indexUrl,
  serial = null,
  attempts = 20,
  delayMs = 15000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const failures = [];
  const warnings = [];

  let index = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      // The query string defeats a CDN that caches the previous deploy.
      const res = await fetchImpl(`${indexUrl}?t=${Date.now()}`);
      if (res.ok) {
        index = await res.json();
        if (serial === null || index.serial >= serial) break;
      } else {
        index = null;
      }
    } catch {
      index = null;
    }
    if (i < attempts) await sleep(delayMs);
  }
  if (!index) return { checked: 0, failures: [`could not fetch a readable index from ${indexUrl}`], warnings };
  if (serial !== null && index.serial < serial) {
    warnings.push(`live serial is ${index.serial}, expected ${serial}: deploy still propagating, verifying what is live`);
  }

  const starters = (Array.isArray(index.entries) ? index.entries : []).filter((e) => e && e.type === "starter");
  let checked = 0;
  for (const entry of starters) {
    const { assets, problems } = assetsOf(entry);
    failures.push(...problems);
    for (const a of assets) {
      checked++;
      try {
        const res = await fetchImpl(a.url);
        if (!res.ok) {
          failures.push(`${a.label}: HTTP ${res.status} for ${a.url}`);
          continue;
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        const sha = createHash("sha256").update(bytes).digest("hex");
        if (bytes.length !== a.size) failures.push(`${a.label}: size ${bytes.length}, index says ${a.size}`);
        if (sha !== a.sha256) failures.push(`${a.label}: sha256 ${sha}, index says ${a.sha256}`);
        if (bytes.length === a.size && sha === a.sha256) console.log(`ok ${a.label} (${bytes.length} bytes)`);
      } catch (e) {
        failures.push(`${a.label}: download failed (${e.message})`);
      }
    }
  }
  return { checked, failures, warnings };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const indexUrl = arg("--index-url");
  if (!indexUrl) {
    console.error("usage: verify-published.mjs --index-url <url> [--serial N] [--attempts N] [--delay-ms N]");
    process.exit(2);
  }
  const serial = arg("--serial") === undefined ? null : Number(arg("--serial"));
  const { checked, failures, warnings } = await verifyPublished({
    indexUrl,
    serial,
    ...(arg("--attempts") && { attempts: Number(arg("--attempts")) }),
    ...(arg("--delay-ms") && { delayMs: Number(arg("--delay-ms")) }),
  });
  for (const w of warnings) console.log(`::warning::${w}`);
  for (const f of failures) console.log(`::error::${f}`);
  console.log(`${checked} starter asset(s) checked, ${failures.length} problem(s)`);
  process.exit(failures.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
