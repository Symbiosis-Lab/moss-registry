// Unit tests for the index generator's decision rules.
//
//   node --test .github/scripts/
//
// Node's built-in runner, no dependencies and no package.json — the registry
// root is deliberately not a workspace, and these must run in a CI job that has
// installed nothing.

import { test } from "node:test";
import assert from "node:assert/strict";

import { selectReleases, toEntry, assembleIndex, SCHEMA_VERSION } from "./build-index.mjs";
import { parseReleaseTag, cmpSemver, tagFor, assetNameFor } from "./registry-rules.mjs";

/** A published release with a correctly-named zip attached. */
function release(tag, overrides = {}) {
  const parsed = parseReleaseTag(tag);
  const name = parsed ? assetNameFor(parsed.id, parsed.version) : "unknown.zip";
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: [{ name, browser_download_url: `https://example.invalid/${tag}/${name}`, url: `https://api.invalid/${tag}` }],
    ...overrides,
  };
}

const reasonFor = (skipped, tag) => skipped.find((s) => s.tag === tag)?.reason;

// ------------------------------------------------------------ tag parsing --

test("parseReleaseTag splits on the last -v so hyphenated ids survive", () => {
  assert.deepEqual(parseReleaseTag("my-plugin-v1.2.3"), { id: "my-plugin", version: "1.2.3" });
  assert.deepEqual(parseReleaseTag("github-v1.5.0"), { id: "github", version: "1.5.0" });
});

test("parseReleaseTag rejects tags the validator would never have allowed", () => {
  assert.equal(parseReleaseTag("moss-core-v1.0.0"), null, "moss- prefix is reserved");
  assert.equal(parseReleaseTag("registry-v1.0.0"), null, "reserved id");
  assert.equal(parseReleaseTag("Github-v1.0.0"), null, "uppercase");
  assert.equal(parseReleaseTag("github-v1.5"), null, "not strict semver");
  assert.equal(parseReleaseTag("v1.0.0"), null, "no id");
  assert.equal(parseReleaseTag("some-random-tag"), null);
});

test("tagFor and parseReleaseTag round-trip", () => {
  for (const [id, version] of [["github", "1.5.0"], ["my-plugin", "0.1.0-beta.1"]]) {
    assert.deepEqual(parseReleaseTag(tagFor(id, version)), { id, version });
  }
});

// -------------------------------------------------------------- selection --

test("a plain published release is selected", () => {
  const { selected } = selectReleases([release("github-v1.5.0")]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, "github");
  assert.equal(selected[0].version, "1.5.0");
});

test("drafts are excluded — this is how a package is retired", () => {
  const { selected, skipped } = selectReleases([release("email-v1.2.0", { draft: true })]);
  assert.deepEqual(selected, []);
  assert.equal(reasonFor(skipped, "email-v1.2.0"), "draft");
});

test("prereleases are excluded", () => {
  const { selected, skipped } = selectReleases([release("github-v1.5.0", { prerelease: true })]);
  assert.deepEqual(selected, []);
  assert.equal(reasonFor(skipped, "github-v1.5.0"), "prerelease");
});

test("a release with no matching zip asset is excluded, not assumed", () => {
  const { selected, skipped } = selectReleases([
    release("github-v1.5.0", { assets: [{ name: "source.tar.gz", browser_download_url: "x", url: "y" }] }),
  ]);
  assert.deepEqual(selected, []);
  assert.match(reasonFor(skipped, "github-v1.5.0"), /no github-1\.5\.0\.zip asset/);
});

test("exactly one entry per id — the highest version wins regardless of order", () => {
  const { selected, skipped } = selectReleases([
    release("github-v1.4.0"),
    release("github-v1.5.0"),
    release("github-v1.2.0"),
  ]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].version, "1.5.0");
  assert.equal(reasonFor(skipped, "github-v1.4.0"), "superseded by github-v1.5.0");
  assert.equal(reasonFor(skipped, "github-v1.2.0"), "superseded by github-v1.5.0");
});

test("the highest version wins when the newest is listed first", () => {
  const { selected } = selectReleases([release("github-v1.5.0"), release("github-v1.4.0")]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].version, "1.5.0");
});

test("every excluded release is accounted for by name and reason", () => {
  // A silent omission in a registry is indistinguishable from a revocation, so
  // the generator must be able to say why each release did not make the index.
  const releases = [
    release("github-v1.5.0"),
    release("email-v1.2.0", { draft: true }),
    release("not-a-release-tag"),
    release("matters-v1.1.0", { assets: [] }),
  ];
  const { selected, skipped } = selectReleases(releases);
  assert.deepEqual(selected.map((s) => s.id), ["github"]);
  assert.deepEqual(
    skipped.map((s) => s.tag).sort(),
    ["email-v1.2.0", "matters-v1.1.0", "not-a-release-tag"],
  );
  assert.ok(skipped.every((s) => typeof s.reason === "string" && s.reason.length > 0));
});

test("the real pre-conversion tag set reduces to the two live plugins once retired ones are drafted", () => {
  // Exactly what `gh release list` showed on 2026-07-28.
  const { selected } = selectReleases([
    release("github-v1.5.0"),
    release("github-v1.1.0", { draft: true }),
    release("matters-v1.1.0"),
    release("comment-v0.1.0", { draft: true }),
    release("email-v1.2.0", { draft: true }),
    release("email-v1.1.0", { draft: true }),
    release("github-v1.4.0"),
    release("github-v1.4.0", { draft: true }),
    release("github-v1.3.0"),
    release("github-v1.2.0"),
    release("matters-v1.0.1"),
    release("email-newsletter-v1.0.0", { draft: true }),
  ]);
  assert.deepEqual(
    selected.map((s) => s.tag),
    ["github-v1.5.0", "matters-v1.1.0"],
    "github-v1.4.0 and matters-v1.1.0 stay published for build.rs's fallback, but only the latest is indexed",
  );
});

test("selection is deterministic and id-sorted", () => {
  const { selected } = selectReleases([release("matters-v1.0.0"), release("github-v1.0.0")]);
  assert.deepEqual(selected.map((s) => s.id), ["github", "matters"]);
});

// ------------------------------------------------------------ entry shape --

const candidate = {
  id: "github",
  version: "1.5.0",
  tag: "github-v1.5.0",
  zip: { browser_download_url: "https://example.invalid/github-1.5.0.zip" },
  icon: undefined,
};

const manifest = {
  name: "github",
  version: "1.5.0",
  description: "Deploy to GitHub Pages via GitHub Actions",
  author: "moss team",
  entry: "main.bundle.js",
  capabilities: ["deploy"],
  requires: ["execute_binary"],
};

test("an entry carries the manifest's metadata and the zip's identity", () => {
  const entry = toEntry(candidate, manifest, { sha256: "abc123", sizeBytes: 60362 });
  assert.equal(entry.type, "plugin");
  assert.equal(entry.id, "github");
  assert.equal(entry.version, "1.5.0");
  assert.equal(entry.description, "Deploy to GitHub Pages via GitHub Actions");
  assert.deepEqual(entry.capabilities, ["deploy"]);
  assert.deepEqual(entry.requires, ["execute_binary"]);
  assert.equal(entry.sha256, "abc123");
  assert.equal(entry.size_bytes, 60362);
  assert.equal(entry.download_url, "https://example.invalid/github-1.5.0.zip");
});

test("a manifest that disagrees with its tag throws rather than dropping the package", () => {
  // Silently omitting it would be indistinguishable from a revocation to clients.
  assert.throws(
    () => toEntry(candidate, { ...manifest, name: "matters" }, { sha256: "a", sizeBytes: 1 }),
    /misdescribes its artifact/,
  );
  assert.throws(
    () => toEntry(candidate, { ...manifest, version: "1.4.0" }, { sha256: "a", sizeBytes: 1 }),
    /says version "1\.4\.0" but the release tag says "1\.5\.0"/,
  );
});

test("absent optional fields are omitted, not emitted empty", () => {
  const entry = toEntry(candidate, manifest, { sha256: "a", sizeBytes: 1 });
  assert.ok(!("repository" in entry));
  assert.ok(!("homepage" in entry));
  assert.ok(!("min_moss_version" in entry));
  assert.ok(!("icon_url" in entry));
});

test("declared optional fields are carried through", () => {
  const rich = { ...manifest, repository: "https://example.invalid/repo", homepage: "https://example.invalid", min_moss_version: "0.8.0" };
  const withIcon = { ...candidate, icon: { browser_download_url: "https://example.invalid/icon.svg" } };
  const entry = toEntry(withIcon, rich, { sha256: "a", sizeBytes: 1 });
  assert.equal(entry.repository, "https://example.invalid/repo");
  assert.equal(entry.homepage, "https://example.invalid");
  assert.equal(entry.min_moss_version, "0.8.0");
  assert.equal(entry.icon_url, "https://example.invalid/icon.svg");
});

test("kind comes from the manifest, defaulting to plugin", () => {
  // Every package published before themes existed has no type field, and a
  // client that saw those entries must keep reading them the same way.
  assert.equal(toEntry(candidate, manifest, { sha256: "a", sizeBytes: 1 }).type, "plugin");
  assert.equal(
    toEntry(candidate, { ...manifest, type: "theme" }, { sha256: "a", sizeBytes: 1 }).type,
    "theme",
    "the index carries theme entries so a v1 client can skip what it does not recognise",
  );
});

test("display_name falls back to the id so the catalog always has a label", () => {
  assert.equal(toEntry(candidate, manifest, { sha256: "a", sizeBytes: 1 }).display_name, "github");
  assert.equal(
    toEntry(candidate, { ...manifest, display_name: "GitHub Pages" }, { sha256: "a", sizeBytes: 1 }).display_name,
    "GitHub Pages",
  );
});

// ----------------------------------------------------------------- index --

test("the index is stamped, sorted and schema-versioned", () => {
  const a = toEntry(candidate, manifest, { sha256: "a", sizeBytes: 1 });
  const b = toEntry(
    { ...candidate, id: "matters", tag: "matters-v1.5.0" },
    { ...manifest, name: "matters" },
    { sha256: "b", sizeBytes: 2 },
  );
  const index = assembleIndex([b, a], { serial: 412 });
  assert.equal(index.schema_version, SCHEMA_VERSION);
  assert.equal(index.serial, 412);
  assert.deepEqual(index.entries.map((e) => e.id), ["github", "matters"]);
});

test("a non-monotonic serial is rejected at generation, not left for clients to catch", () => {
  assert.throws(() => assembleIndex([], { serial: 0 }), /positive integer/);
  assert.throws(() => assembleIndex([], { serial: 1.5 }), /positive integer/);
  assert.throws(() => assembleIndex([], { serial: undefined }), /positive integer/);
});

test("an empty registry still produces a valid index", () => {
  // Which is the state right after first-party source leaves and before the
  // first contributor plugin lands — clients must read it, not fail on it.
  const index = assembleIndex([], { serial: 1 });
  assert.deepEqual(index, { schema_version: 1, serial: 1, entries: [] });
});

// ------------------------------------------------------------ comparisons --

test("cmpSemver orders by numeric core, ignoring pre-release", () => {
  assert.equal(cmpSemver("1.5.0", "1.4.0"), 1);
  assert.equal(cmpSemver("1.4.0", "1.5.0"), -1);
  assert.equal(cmpSemver("1.10.0", "1.9.0"), 1, "numeric, not lexicographic");
  assert.equal(cmpSemver("1.0.0", "1.0.0-beta.1"), 0, "pre-release ignored");
});
