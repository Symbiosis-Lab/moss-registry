#!/usr/bin/env node
// Generate index.json from the registry's published releases.
//
//   node .github/scripts/build-index.mjs --serial <n> --out index.json
//
// The index is what moss fetches to know what exists. It is derived from
// releases and never hand-edited or committed, so it always describes what has
// actually been published rather than what someone wrote down. Every piece of
// metadata comes from the manifest inside the published zip, which is what makes
// index/manifest drift impossible by construction.
//
// Node builtins only, so CI runs it without installing anything.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  cmpSemver,
  parseReleaseTag,
  assetNameFor,
  iconAssetPrefixFor,
} from "./registry-rules.mjs";

export const SCHEMA_VERSION = 1;
export const REPO = "Symbiosis-Lab/moss-registry";

/**
 * Decide which releases become index entries.
 *
 * A release qualifies when it is published (not a draft, not a prerelease) and
 * its tag names one of our packages. Of the qualifying releases for an id, the
 * highest version wins — the index carries exactly one entry per id, so
 * "which version replaced a revoked one" always has the answer "the current
 * entry for that id, if it is not itself revoked".
 *
 * Drafting a release is therefore how a package leaves the catalog: it is the
 * mechanism for retiring a plugin, not just a bookkeeping state.
 *
 * Pure. Returns candidates plus the reason every other release was passed over,
 * because a silent omission in a registry looks exactly like a revocation.
 */
export function selectReleases(releases) {
  const best = new Map();
  const skipped = [];

  for (const release of releases) {
    const tag = release.tag_name;
    if (release.draft) {
      skipped.push({ tag, reason: "draft" });
      continue;
    }
    if (release.prerelease) {
      skipped.push({ tag, reason: "prerelease" });
      continue;
    }
    const parsed = parseReleaseTag(tag);
    if (!parsed) {
      skipped.push({ tag, reason: "tag is not <id>-v<semver> with a valid id" });
      continue;
    }
    const { id, version } = parsed;
    const assets = release.assets ?? [];
    const zip = assets.find((a) => a.name === assetNameFor(id, version));
    if (!zip) {
      skipped.push({ tag, reason: `no ${assetNameFor(id, version)} asset attached` });
      continue;
    }
    const icon = assets.find((a) => a.name.startsWith(iconAssetPrefixFor(id, version)));

    const previous = best.get(id);
    if (previous && cmpSemver(version, previous.version) <= 0) {
      skipped.push({ tag, reason: `superseded by ${previous.tag}` });
      continue;
    }
    if (previous) skipped.push({ tag: previous.tag, reason: `superseded by ${tag}` });
    best.set(id, { id, version, tag, zip, icon });
  }

  return { selected: [...best.values()].sort((a, b) => a.id.localeCompare(b.id)), skipped };
}

/**
 * Turn one selected release into an index entry.
 *
 * The manifest is read from inside the published zip, so the entry describes the
 * bytes users will actually install. A manifest whose name disagrees with the
 * tag means the release was assembled wrongly; that throws rather than being
 * skipped, because dropping the package instead would read to every client as a
 * deliberate withdrawal.
 */
export function toEntry(candidate, manifest, { sha256, sizeBytes }) {
  const { id, version, tag, zip, icon } = candidate;

  if (manifest.name !== id) {
    throw new Error(
      `${tag}: the zip's manifest.json says name "${manifest.name}" but the release tag says "${id}" — refusing to publish an index entry that misdescribes its artifact`,
    );
  }
  if (manifest.version !== version) {
    throw new Error(
      `${tag}: the zip's manifest.json says version "${manifest.version}" but the release tag says "${version}"`,
    );
  }

  const entry = {
    type: "plugin",
    id,
    display_name: manifest.display_name ?? id,
    version,
    description: manifest.description ?? "",
    author: manifest.author ?? "",
    capabilities: manifest.capabilities ?? [],
    download_url: zip.browser_download_url,
    sha256,
    size_bytes: sizeBytes,
  };

  // Optional fields are omitted rather than emitted empty: clients ignore
  // unknown fields, but an empty string is a value that renders.
  if (manifest.repository) entry.repository = manifest.repository;
  if (manifest.homepage) entry.homepage = manifest.homepage;
  if (manifest.min_moss_version) entry.min_moss_version = manifest.min_moss_version;
  if (manifest.requires?.length) entry.requires = manifest.requires;
  if (icon) entry.icon_url = icon.browser_download_url;

  return entry;
}

/**
 * Assemble the file clients fetch.
 *
 * `serial` is monotonic and clients reject anything lower than the highest they
 * have seen, which is what makes a captured older copy useless for replaying a
 * revoked version back into the catalog.
 */
export function assembleIndex(entries, { serial }) {
  if (!Number.isInteger(serial) || serial < 1) {
    throw new Error(`serial must be a positive integer, got ${serial}`);
  }
  return {
    schema_version: SCHEMA_VERSION,
    serial,
    entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

// ------------------------------------------------------------------- I/O --
// Everything above is pure and unit-tested. Everything below talks to GitHub.

async function fetchAllReleases(repo, token) {
  const out = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "moss-registry-build-index",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!res.ok) throw new Error(`GET /releases page ${page}: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

async function downloadAsset(asset, token, dir) {
  const res = await fetch(asset.url, {
    headers: {
      accept: "application/octet-stream",
      "user-agent": "moss-registry-build-index",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`download ${asset.name}: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const path = join(dir, asset.name);
  writeFileSync(path, bytes);
  return { path, bytes };
}

/** Read one file out of a zip without a dependency. `unzip` is on every runner. */
function readManifestFromZip(zipPath) {
  const raw = execFileSync("unzip", ["-p", zipPath, "manifest.json"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

async function main(argv) {
  const serialArg = argv[argv.indexOf("--serial") + 1];
  const outArg = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "index.json";
  const serial = Number(serialArg);
  const token = process.env.GITHUB_TOKEN;

  const releases = await fetchAllReleases(REPO, token);
  const { selected, skipped } = selectReleases(releases);

  for (const s of skipped) console.log(`skip ${s.tag}: ${s.reason}`);

  const dir = mkdtempSync(join(tmpdir(), "moss-index-"));
  const entries = [];
  for (const candidate of selected) {
    const { path, bytes } = await downloadAsset(candidate.zip, token, dir);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const manifest = readManifestFromZip(path);
    entries.push(toEntry(candidate, manifest, { sha256, sizeBytes: bytes.length }));
    console.log(`index ${candidate.tag} (${bytes.length} bytes, sha256 ${sha256.slice(0, 12)}…)`);
  }

  const index = assembleIndex(entries, { serial });
  writeFileSync(outArg, JSON.stringify(index, null, 2) + "\n");
  console.log(`wrote ${outArg}: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}, serial ${serial}`);
}

if (import.meta.filename === process.argv[1]) {
  main(process.argv).catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
