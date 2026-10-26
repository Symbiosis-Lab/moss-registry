#!/usr/bin/env node
// Post-publish check: re-download every starter asset, and every program a
// plugin downloads at first use, through the LIVE index and compare it with
// what the index promises.
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
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { artifactPlatforms, derivationArtifacts } from "./registry-rules.mjs";

/** manifest.json out of a release zip's bytes. `unzip` is on every runner. */
export function readManifestFromBytes(bytes) {
  const dir = mkdtempSync(join(tmpdir(), "moss-verify-"));
  try {
    const zip = join(dir, "plugin.zip");
    writeFileSync(zip, bytes);
    return JSON.parse(execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
  readManifest = readManifestFromBytes,
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

  // A plugin that is a program moss downloads: its zip must be what the index
  // says, and each program its manifest pins must hash to the pin. The index
  // lists only `platforms`, so the manifest in the zip is the source of the URLs.
  const programs = (Array.isArray(index.entries) ? index.entries : []).filter(
    (e) => e && e.type !== "starter" && Array.isArray(e.platforms) && e.platforms.length > 0,
  );
  const fetchBytes = async (label, url) => {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        failures.push(`${label}: HTTP ${res.status} for ${url}`);
        return null;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      failures.push(`${label}: download failed (${e.message})`);
      return null;
    }
  };
  for (const entry of programs) {
    const where = `${entry.id}@${entry.version}`;
    checked++;
    const zip = await fetchBytes(`${where} zip`, entry.download_url);
    if (!zip) continue;
    if (createHash("sha256").update(zip).digest("hex") !== entry.sha256 || zip.length !== entry.size_bytes) {
      failures.push(`${where} zip: bytes differ from the index's sha256/size`);
      continue;
    }
    let manifest;
    try {
      manifest = readManifest(zip);
    } catch (e) {
      failures.push(`${where} zip: manifest.json unreadable (${e.message})`);
      continue;
    }
    if (JSON.stringify(artifactPlatforms(manifest)) !== JSON.stringify(entry.platforms)) {
      failures.push(`${where}: index platforms ${JSON.stringify(entry.platforms)} differ from the manifest's ${JSON.stringify(artifactPlatforms(manifest))}`);
    }
    for (const { derivation, artifact } of derivationArtifacts(manifest)) {
      if (artifact.kind !== "download") continue;
      const label = `${where} program ${derivation}/${artifact.platform}`;
      checked++;
      if (typeof artifact.url !== "string" || !artifact.url) {
        failures.push(`${label}: manifest has no url`);
        continue;
      }
      const bytes = await fetchBytes(label, artifact.url);
      if (!bytes) continue;
      const sha = createHash("sha256").update(bytes).digest("hex");
      if (sha !== artifact.sha256) failures.push(`${label}: sha256 ${sha}, manifest pins ${artifact.sha256}`);
      else console.log(`ok ${label} (${bytes.length} bytes)`);
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
  console.log(`${checked} asset(s) checked, ${failures.length} problem(s)`);
  process.exit(failures.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
