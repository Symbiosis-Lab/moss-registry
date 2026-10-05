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
  parseStarterTag,
  starterSourceAssetFor,
  starterPreviewAssetFor,
  starterMetaAssetFor,
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
    // Which kind of package this is. The directory decides it — plugins/<id>/
    // or themes/<id>/ — and the manifest restates it so the artifact is
    // self-describing once it is out of the repo and the index has only the
    // release to read. validate-plugin.mjs rejects a manifest whose type
    // disagrees with the directory it sits in, so the two cannot drift.
    // Absent means plugin: every package published before themes existed.
    type: manifest.type ?? "plugin",
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

  // Catalog-presentation bits, re-emitted from the manifest so a remote row
  // renders exactly like a bundled one. `preview` says the publisher does not
  // consider this version ready to be offered by default (moss ADR-053);
  // `requires_stack` says first install pulls a machine-wide companion
  // runtime. Both are omitted when false, so an entry for a package that
  // declares neither is byte-identical to what this script emitted before
  // the fields existed.
  //
  // The rule for what belongs here: re-emit every manifest field that drives
  // PRE-INSTALL catalog presentation. Post-install fields (config_schema,
  // contributes, domain, domains, entry, config_verify) stay out — the
  // installed manifest is authoritative for those.
  if (manifest.preview === true) entry.preview = true;
  if (manifest.requires_stack === true) entry.requires_stack = true;

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
    entries: orderEntries(entries),
  };
}

/**
 * Plugins and themes first, by id, exactly as before starters existed; then
 * starters in the order their manifests ask the picker to show them. Sorting
 * by type first, rather than interleaving by id, keeps the plugin part of the
 * file identical whether or not any starter is published.
 */
function orderEntries(entries) {
  const isStarter = (e) => e.type === "starter";
  const rest = entries.filter((e) => !isStarter(e)).sort((a, b) => a.id.localeCompare(b.id));
  const starters = entries
    .filter(isStarter)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  return [...rest, ...starters];
}

// --------------------------------------------------------------- starters --
// A starter version is a release tagged starter-<id>-v<semver> with a source
// zip and, optionally, a preview zip and a small json naming the moss that
// built the preview. Everything here is additive: a starter that cannot be
// described is skipped with a warning and never stops the index.

/** The six fields every registry client ever shipped requires of any entry. */
export const CLIENT_REQUIRED_FIELDS = ["type", "id", "display_name", "version", "download_url", "sha256"];

/**
 * Pick the starter releases that may become entries: published, well-tagged,
 * carrying their source zip, highest version per id. Pure; every release passed
 * over is accounted for, as in selectReleases.
 */
export function selectStarterReleases(releases) {
  const best = new Map();
  const skipped = [];
  for (const release of releases) {
    const tag = release.tag_name;
    const parsed = parseStarterTag(tag);
    if (!parsed) continue; // not a starter release; the plugin path owns the rest
    if (release.draft) {
      skipped.push({ tag, reason: "draft" });
      continue;
    }
    if (release.prerelease) {
      skipped.push({ tag, reason: "prerelease" });
      continue;
    }
    const { id, version } = parsed;
    const assets = release.assets ?? [];
    const named = (name) => assets.find((a) => a.name === name);
    const source = named(starterSourceAssetFor(id, version));
    if (!source) {
      skipped.push({ tag, reason: `no ${starterSourceAssetFor(id, version)} asset attached` });
      continue;
    }
    const previous = best.get(id);
    if (previous && cmpSemver(version, previous.version) <= 0) {
      skipped.push({ tag, reason: `superseded by ${previous.tag}` });
      continue;
    }
    if (previous) skipped.push({ tag: previous.tag, reason: `superseded by ${tag}` });
    best.set(id, {
      id,
      version,
      tag,
      source,
      preview: named(starterPreviewAssetFor(id, version)),
      meta: named(starterMetaAssetFor(id, version)),
    });
  }
  return { selected: [...best.values()].sort((a, b) => a.id.localeCompare(b.id)), skipped };
}

/**
 * Turn one selected starter release into an index entry, from the bytes of the
 * release: manifest fields from manifest.json inside the source zip, hashes and
 * sizes from the downloaded assets, URLs from the release's own asset URLs.
 *
 * `source` and `preview` are { sha256, sizeBytes } (preview null when absent);
 * `meta` is the parsed sidecar json or null. The four preview fields come
 * together or not at all: they are omitted when the preview or the sidecar is
 * missing, or when the sidecar's hashes disagree with the zips it describes
 * (it would then be naming a different build). Returns { entry, warnings };
 * throws when the entry would lack a field clients require, because one such
 * entry fails the whole index for every installed app.
 */
export function toStarterEntry(candidate, manifest, { source, preview, meta }) {
  const { id, version, tag } = candidate;
  if (manifest?.id !== id || manifest?.version !== version) {
    throw new Error(`${tag}: manifest.json says ${manifest?.id}@${manifest?.version}, the tag says ${id}@${version}`);
  }
  const entry = {
    type: "starter",
    id,
    version,
    display_name: manifest.name,
    description: manifest.line,
    credit: manifest.credit,
    language: manifest.language,
    order: manifest.order,
    min_moss_version: manifest.min_moss_version,
    tour: manifest.tour,
    download_url: candidate.source.browser_download_url,
    sha256: source.sha256,
    size_bytes: source.sizeBytes,
  };
  const warnings = [];
  if (candidate.preview && preview) {
    const carrier = meta && typeof meta.preview_moss_version === "string" && meta.preview_moss_version !== "";
    if (!carrier) {
      warnings.push(`${tag}: preview zip without a readable ${starterMetaAssetFor(id, version)}; omitting preview fields`);
    } else if (meta.source_sha256 !== source.sha256 || meta.preview_sha256 !== preview.sha256) {
      warnings.push(`${tag}: ${starterMetaAssetFor(id, version)} describes different zips than the ones attached; omitting preview fields`);
    } else {
      entry.preview_url = candidate.preview.browser_download_url;
      entry.preview_sha256 = preview.sha256;
      entry.preview_size_bytes = preview.sizeBytes;
      entry.preview_moss_version = meta.preview_moss_version;
    }
  }
  for (const key of CLIENT_REQUIRED_FIELDS) {
    if (typeof entry[key] !== "string" || entry[key] === "") {
      throw new Error(`${tag}: entry would lack required field "${key}"; refusing to emit it`);
    }
  }
  return { entry, warnings };
}

/**
 * Starter entries for every starter release, given a way to fetch an asset
 * ({ path, bytes }) and to read manifest.json out of a zip. Nothing in here may
 * throw past its caller: a starter that cannot be fetched or described is
 * skipped with a warning, so the plugin entries and revoked.json still deploy.
 */
export async function buildStarterEntries(releases, { fetchAsset, readManifest, warn = () => {} }) {
  const entries = [];
  let selected = [];
  try {
    const picked = selectStarterReleases(releases);
    selected = picked.selected;
    for (const s of picked.skipped) console.log(`skip ${s.tag}: ${s.reason}`);
  } catch (e) {
    warn(`starters: selection failed: ${e.message}`);
    return entries;
  }
  for (const candidate of selected) {
    try {
      const src = await fetchAsset(candidate.source);
      const manifest = readManifest(src.path);
      const hashed = (a) => ({ sha256: createHash("sha256").update(a.bytes).digest("hex"), sizeBytes: a.bytes.length });
      let preview = null;
      let meta = null;
      if (candidate.preview) {
        try {
          preview = hashed(await fetchAsset(candidate.preview));
          if (candidate.meta) meta = JSON.parse((await fetchAsset(candidate.meta)).bytes.toString("utf8"));
        } catch (e) {
          warn(`${candidate.tag}: preview assets unreadable (${e.message}); omitting preview fields`);
          preview = null;
        }
      }
      const { entry, warnings } = toStarterEntry(candidate, manifest, { source: hashed(src), preview, meta });
      warnings.forEach(warn);
      entries.push(entry);
      console.log(`index ${candidate.tag} (starter, ${entry.size_bytes} bytes)`);
    } catch (e) {
      warn(`${candidate.tag}: skipped, ${e.message}`);
    }
  }
  return entries;
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

  // A starter release is not a plugin whose zip is missing; the starter path
  // below reports on it.
  for (const s of skipped) if (!parseStarterTag(s.tag)) console.log(`skip ${s.tag}: ${s.reason}`);

  const dir = mkdtempSync(join(tmpdir(), "moss-index-"));
  const entries = [];
  for (const candidate of selected) {
    const { path, bytes } = await downloadAsset(candidate.zip, token, dir);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const manifest = readManifestFromZip(path);
    entries.push(toEntry(candidate, manifest, { sha256, sizeBytes: bytes.length }));
    console.log(`index ${candidate.tag} (${bytes.length} bytes, sha256 ${sha256.slice(0, 12)}…)`);
  }

  // Starters are additive and isolated: whatever goes wrong in here, the plugin
  // entries above are already complete and the index is still written.
  try {
    entries.push(
      ...(await buildStarterEntries(releases, {
        fetchAsset: (asset) => downloadAsset(asset, token, dir),
        readManifest: readManifestFromZip,
        warn: (msg) => console.log(`::warning::${msg}`),
      })),
    );
  } catch (e) {
    console.log(`::warning::starters: ${e.message}`);
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
