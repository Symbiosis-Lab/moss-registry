// Unit tests for the index generator's decision rules.
//
//   node --test .github/scripts/
//
// Node's built-in runner, no dependencies and no package.json — the registry
// root is deliberately not a workspace, and these must run in a CI job that has
// installed nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  selectReleases,
  toEntry,
  assembleIndex,
  SCHEMA_VERSION,
  selectStarterReleases,
  toStarterEntry,
  buildStarterEntries,
} from "./build-index.mjs";
import { parseReleaseTag, cmpSemver, tagFor, assetNameFor, parseStarterTag } from "./registry-rules.mjs";

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
  // preview/requires_stack omitted-when-false pins byte-identical output for
  // every already-published package — what makes the index rebuild safe.
  const entry = toEntry(candidate, manifest, { sha256: "a", sizeBytes: 1 });
  assert.ok(!("repository" in entry));
  assert.ok(!("homepage" in entry));
  assert.ok(!("min_moss_version" in entry));
  assert.ok(!("icon_url" in entry));
  assert.ok(!("preview" in entry));
  assert.ok(!("requires_stack" in entry));
});

test("declared optional fields are carried through", () => {
  const rich = { ...manifest, repository: "https://example.invalid/repo", homepage: "https://example.invalid", min_moss_version: "0.8.0", preview: true, requires_stack: true };
  const withIcon = { ...candidate, icon: { browser_download_url: "https://example.invalid/icon.svg" } };
  const entry = toEntry(withIcon, rich, { sha256: "a", sizeBytes: 1 });
  assert.equal(entry.repository, "https://example.invalid/repo");
  assert.equal(entry.homepage, "https://example.invalid");
  assert.equal(entry.min_moss_version, "0.8.0");
  assert.equal(entry.icon_url, "https://example.invalid/icon.svg");
  assert.equal(entry.preview, true);
  assert.equal(entry.requires_stack, true);
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

// --------------------------------------------------------------- starters --

const asset = (tag, name) => ({ name, browser_download_url: `https://example.invalid/${tag}/${name}`, url: `https://api.invalid/${tag}/${name}` });

/** A starter release; `names` are the assets attached, by default all five. */
function starterRelease(id, version, { names, ...overrides } = {}) {
  const tag = `starter-${id}-v${version}`;
  const all = [`${id}-${version}.zip`, `${id}-${version}-preview.zip`, `${id}-${version}.json`, `${id}-${version}-poster-light.jpg`, `${id}-${version}-poster-dark.jpg`];
  return { tag_name: tag, draft: false, prerelease: false, assets: (names ?? all).map((n) => asset(tag, n)), ...overrides };
}

const starterManifest = (id = "essays", version = "1.0.0", extra = {}) => ({
  schema_version: 1,
  id,
  version,
  name: "Essays",
  line: "A writer's own site.",
  credit: "Public-domain essays.",
  language: "en",
  min_moss_version: "0.15.4",
  order: 1,
  tour: [{ label: "Home", path: "/" }],
  ...extra,
});

test("a starter tag parses, and a plugin tag does not", () => {
  assert.deepEqual(parseStarterTag("starter-vertical-v1.0.0"), { id: "vertical", version: "1.0.0" });
  assert.equal(parseStarterTag("github-v1.5.0"), null);
  assert.equal(parseStarterTag("starter-v1.0.0"), null);
  assert.equal(parseStarterTag("starter-essays-v1.0"), null);
});

test("starter releases never change which plugins are selected", () => {
  const plugins = [release("github-v1.5.0"), release("matters-v1.1.0"), release("email-v1.2.0", { draft: true })];
  const starters = [starterRelease("essays", "1.0.0"), starterRelease("organisation", "1.2.0")];
  const without = selectReleases(plugins).selected;
  const withThem = selectReleases([...starters, ...plugins]).selected;
  assert.deepEqual(withThem, without);
});

test("starter selection ignores plugins, takes the highest version, and accounts for the rest", () => {
  const { selected, skipped } = selectStarterReleases([
    release("github-v1.5.0"),
    starterRelease("essays", "1.0.0"),
    starterRelease("essays", "1.10.0"),
    starterRelease("essays", "1.9.0"),
    starterRelease("organisation", "1.0.0", { draft: true }),
    starterRelease("vertical", "1.0.0", { prerelease: true }),
    starterRelease("lonely", "1.0.0", { names: ["lonely-1.0.0-preview.zip"] }),
  ]);
  assert.deepEqual(selected.map((s) => s.tag), ["starter-essays-v1.10.0"]);
  assert.equal(reasonFor(skipped, "starter-essays-v1.9.0"), "superseded by starter-essays-v1.10.0");
  assert.equal(reasonFor(skipped, "starter-organisation-v1.0.0"), "draft");
  assert.equal(reasonFor(skipped, "starter-vertical-v1.0.0"), "prerelease");
  assert.match(reasonFor(skipped, "starter-lonely-v1.0.0"), /no lonely-1\.0\.0\.zip asset/);
  assert.ok(!skipped.some((s) => s.tag === "github-v1.5.0"));
});

const bytesOf = { source: { sha256: "a".repeat(64), sizeBytes: 100 }, preview: { sha256: "b".repeat(64), sizeBytes: 900 } };
const posterBytes = { light: { sha256: "c".repeat(64), sizeBytes: 70000 }, dark: { sha256: "d".repeat(64), sizeBytes: 65000 } };
const goodMeta = {
  preview_moss_version: "0.15.4",
  source_sha256: "a".repeat(64),
  preview_sha256: "b".repeat(64),
  poster_light_sha256: "c".repeat(64),
  poster_dark_sha256: "d".repeat(64),
};

test("a starter entry carries exactly the agreed fields, from the release's own bytes", () => {
  const candidate = selectStarterReleases([starterRelease("essays", "1.0.0")]).selected[0];
  const { entry, warnings } = toStarterEntry(candidate, starterManifest(), { ...bytesOf, posters: posterBytes, meta: goodMeta });
  assert.deepEqual(warnings, []);
  assert.deepEqual(entry, {
    type: "starter",
    id: "essays",
    version: "1.0.0",
    display_name: "Essays",
    description: "A writer's own site.",
    credit: "Public-domain essays.",
    language: "en",
    order: 1,
    min_moss_version: "0.15.4",
    tour: [{ label: "Home", path: "/" }],
    download_url: "https://example.invalid/starter-essays-v1.0.0/essays-1.0.0.zip",
    sha256: "a".repeat(64),
    size_bytes: 100,
    preview_url: "https://example.invalid/starter-essays-v1.0.0/essays-1.0.0-preview.zip",
    preview_sha256: "b".repeat(64),
    preview_size_bytes: 900,
    preview_moss_version: "0.15.4",
    poster_light_url: "https://example.invalid/starter-essays-v1.0.0/essays-1.0.0-poster-light.jpg",
    poster_light_sha256: "c".repeat(64),
    poster_light_size_bytes: 70000,
    poster_dark_url: "https://example.invalid/starter-essays-v1.0.0/essays-1.0.0-poster-dark.jpg",
    poster_dark_sha256: "d".repeat(64),
    poster_dark_size_bytes: 65000,
  });
});

test("poster fields come together or not at all, and only when the sidecar vouches for the bytes", () => {
  const full = selectStarterReleases([starterRelease("essays", "1.0.0")]).selected[0];
  const oneLight = selectStarterReleases([starterRelease("essays", "1.0.0", { names: ["essays-1.0.0.zip", "essays-1.0.0.json", "essays-1.0.0-poster-light.jpg"] })]).selected[0];
  const legacy = selectStarterReleases([starterRelease("essays", "1.0.0", { names: ["essays-1.0.0.zip", "essays-1.0.0-preview.zip", "essays-1.0.0.json"] })]).selected[0];
  const none = (e) => !Object.keys(e).some((k) => k.startsWith("poster_"));
  const args = { ...bytesOf, posters: posterBytes, meta: goodMeta };

  // A release cut before posters existed has none and says nothing about it.
  const old = toStarterEntry(legacy, starterManifest(), { ...bytesOf, meta: goodMeta });
  assert.ok(none(old.entry));
  assert.deepEqual(old.warnings, []);
  // Half a pair is no pair.
  const half = toStarterEntry(oneLight, starterManifest(), { source: bytesOf.source, preview: null, meta: goodMeta, posters: { light: posterBytes.light } });
  assert.ok(none(half.entry));
  assert.match(half.warnings[0], /poster assets incomplete/);
  // A sidecar written for other bytes must not be believed.
  for (const key of ["poster_light_sha256", "poster_dark_sha256"]) {
    const stale = toStarterEntry(full, starterManifest(), { ...args, meta: { ...goodMeta, [key]: "e".repeat(64) } });
    assert.ok(none(stale.entry), key);
    assert.match(stale.warnings[0], /does not name the attached posters/);
  }
  const noMeta = toStarterEntry(full, starterManifest(), { ...args, meta: null });
  assert.ok(none(noMeta.entry));
  // Preview fields are independent of the posters.
  assert.equal(noMeta.entry.preview_url, undefined);
});

test("preview fields come together or not at all", () => {
  const withPreview = selectStarterReleases([starterRelease("essays", "1.0.0")]).selected[0];
  const noPreview = selectStarterReleases([starterRelease("essays", "1.0.0", { names: ["essays-1.0.0.zip"] })]).selected[0];
  const noMeta = selectStarterReleases([starterRelease("essays", "1.0.0", { names: ["essays-1.0.0.zip", "essays-1.0.0-preview.zip"] })]).selected[0];
  const none = (e) => !Object.keys(e).some((k) => k.startsWith("preview_"));

  assert.ok(none(toStarterEntry(noPreview, starterManifest(), { source: bytesOf.source, preview: null, meta: null }).entry));
  const missingMeta = toStarterEntry(noMeta, starterManifest(), { ...bytesOf, meta: null });
  assert.ok(none(missingMeta.entry));
  assert.equal(missingMeta.warnings.length, 1);
  // A sidecar written for other bytes must not be believed.
  const stale = toStarterEntry(withPreview, starterManifest(), { ...bytesOf, meta: { ...goodMeta, preview_sha256: "c".repeat(64) } });
  assert.ok(none(stale.entry));
  assert.match(stale.warnings[0], /different zips/);
});

test("an entry lacking a field every client requires is refused", () => {
  const candidate = selectStarterReleases([starterRelease("essays", "1.0.0")]).selected[0];
  const noName = { ...starterManifest() };
  delete noName.name;
  assert.throws(() => toStarterEntry(candidate, noName, { ...bytesOf, meta: goodMeta }), /required field "display_name"/);
  assert.throws(
    () => toStarterEntry(candidate, starterManifest(), { source: { sha256: "", sizeBytes: 1 }, preview: null, meta: null }),
    /required field "sha256"/,
  );
  assert.throws(() => toStarterEntry(candidate, starterManifest("other"), { ...bytesOf, meta: goodMeta }), /the tag says essays@1\.0\.0/);
});

test("demo_url is carried when the manifest has it and absent when it does not", () => {
  const candidate = selectStarterReleases([starterRelease("essays", "1.0.0")]).selected[0];
  const args = { ...bytesOf, posters: posterBytes, meta: goodMeta };
  const withDemo = toStarterEntry(candidate, starterManifest("essays", "1.0.0", { demo_url: "https://example.invalid/demo/" }), args);
  assert.equal(withDemo.entry.demo_url, "https://example.invalid/demo/");
  assert.deepEqual(withDemo.warnings, []);
  assert.ok(!("demo_url" in toStarterEntry(candidate, starterManifest(), args).entry));
});

test("a bad demo_url costs the entry its link, not the entry", () => {
  const candidate = selectStarterReleases([starterRelease("essays", "1.0.0")]).selected[0];
  for (const bad of ["http://example.invalid/", "not a url", "https://user:pw@example.invalid/", "", 42, "javascript:alert(1)"]) {
    const { entry, warnings } = toStarterEntry(candidate, starterManifest("essays", "1.0.0", { demo_url: bad }), { ...bytesOf, meta: goodMeta });
    assert.equal(entry.id, "essays", `entry survives demo_url ${JSON.stringify(bad)}`);
    assert.ok(!("demo_url" in entry));
    assert.match(warnings.join("\n"), /demo_url/);
  }
});

/** Fetcher over in-memory files; `broken` names fail the way a 404 would. */
function fixtureFetch(files, broken = []) {
  return async (a) => {
    if (broken.includes(a.name)) throw new Error(`download ${a.name}: 404`);
    return { path: a.name, bytes: Buffer.from(files[a.name] ?? `bytes of ${a.name}`) };
  };
}

test("starters that cannot be described are skipped with a warning and the rest survive", async () => {
  const warnings = [];
  const manifests = {
    "essays-1.0.0.zip": starterManifest(),
    "organisation-1.0.0.zip": starterManifest("organisation", "1.0.0", { order: 2 }),
    "nameless-1.0.0.zip": (() => { const m = starterManifest("nameless"); delete m.name; return m; })(),
    "gone-1.0.0.zip": starterManifest("gone"),
  };
  const entries = await buildStarterEntries(
    [
      starterRelease("essays", "1.0.0"),
      starterRelease("organisation", "1.0.0"),
      starterRelease("nameless", "1.0.0"),
      starterRelease("gone", "1.0.0"),
      starterRelease("nozip", "1.0.0", { names: [] }),
    ],
    { fetchAsset: fixtureFetch({}, ["gone-1.0.0.zip"]), readManifest: (p) => manifests[p], warn: (m) => warnings.push(m) },
  );
  assert.deepEqual(entries.map((e) => e.id), ["essays", "organisation"]);
  assert.ok(warnings.some((w) => /starter-nameless-v1\.0\.0.*display_name/.test(w)));
  assert.ok(warnings.some((w) => /starter-gone-v1\.0\.0.*404/.test(w)));
  // No sidecar bytes parse as JSON here, so previews are dropped, not fatal.
  assert.ok(entries.every((e) => !("preview_url" in e)));
});

test("a broken preview download drops only the preview fields", async () => {
  const warnings = [];
  const entries = await buildStarterEntries([starterRelease("essays", "1.0.0")], {
    fetchAsset: fixtureFetch({}, ["essays-1.0.0-preview.zip"]),
    readManifest: () => starterManifest(),
    warn: (m) => warnings.push(m),
  });
  assert.equal(entries.length, 1);
  assert.ok(!("preview_url" in entries[0]));
  assert.match(warnings[0], /preview unreadable/);
});

test("a broken poster download drops the poster fields, not the entry", async () => {
  const warnings = [];
  const files = { "essays-1.0.0.json": JSON.stringify(goodMeta) };
  const fetchAsset = async (a) => {
    if (a.name === "essays-1.0.0-poster-dark.jpg") throw new Error("download: 404");
    return { path: a.name, bytes: Buffer.from(files[a.name] ?? `bytes of ${a.name}`) };
  };
  const [entry] = await buildStarterEntries([starterRelease("essays", "1.0.0")], {
    fetchAsset,
    readManifest: () => starterManifest(),
    warn: (m) => warnings.push(m),
  });
  assert.ok(!Object.keys(entry).some((k) => k.startsWith("poster_")));
  assert.ok(warnings.some((w) => /poster dark unreadable/.test(w)));
});

test("every field of a full starter entry has the JSON type the reader expects", async () => {
  const sha = (t) => createHash("sha256").update(t).digest("hex");
  const files = {};
  const meta = { preview_moss_version: "0.15.4" };
  for (const [key, name] of [["source", "essays-1.0.0.zip"], ["preview", "essays-1.0.0-preview.zip"], ["poster_light", "essays-1.0.0-poster-light.jpg"], ["poster_dark", "essays-1.0.0-poster-dark.jpg"]]) {
    files[name] = `bytes of ${name}`;
    meta[`${key}_sha256`] = sha(files[name]);
  }
  files["essays-1.0.0.json"] = JSON.stringify(meta);
  const [entry] = await buildStarterEntries([starterRelease("essays", "1.0.0")], {
    fetchAsset: fixtureFetch(files),
    readManifest: () => starterManifest(),
    warn: (m) => assert.fail(m),
  });
  const strings = ["type", "id", "version", "display_name", "description", "credit", "language", "min_moss_version", "download_url", "sha256",
    "preview_url", "preview_sha256", "preview_moss_version", "poster_light_url", "poster_light_sha256", "poster_dark_url", "poster_dark_sha256"];
  const ints = ["order", "size_bytes", "preview_size_bytes", "poster_light_size_bytes", "poster_dark_size_bytes"];
  for (const k of strings) assert.equal(typeof entry[k], "string", k);
  for (const k of ints) assert.ok(Number.isInteger(entry[k]), k);
  assert.ok(Array.isArray(entry.tour));
  assert.deepEqual(Object.keys(entry).filter((k) => ![...strings, ...ints, "tour"].includes(k)), []);
});

test("the plugin part of the index is byte-identical with and without starters", async () => {
  const pluginEntries = [
    toEntry(candidate, manifest, { sha256: "a", sizeBytes: 1 }),
    toEntry({ ...candidate, id: "matters", tag: "matters-v1.5.0" }, { ...manifest, name: "matters" }, { sha256: "b", sizeBytes: 2 }),
  ];
  const starterEntries = await buildStarterEntries([starterRelease("essays", "1.0.0")], {
    fetchAsset: fixtureFetch({}),
    readManifest: () => starterManifest(),
  });
  const alone = assembleIndex(pluginEntries, { serial: 9 });
  const together = assembleIndex([...starterEntries, ...pluginEntries], { serial: 9 });
  const pluginPart = (idx) => JSON.stringify(idx.entries.filter((e) => e.type !== "starter"));
  assert.equal(pluginPart(together), pluginPart(alone));
  assert.equal(together.entries.length, 3);
});

test("starters sort after plugins, by order then id, whatever the ids are", () => {
  const plugin = toEntry(candidate, manifest, { sha256: "a", sizeBytes: 1 }); // id "github"
  const s = (id, order) => ({ type: "starter", id, order });
  const index = assembleIndex([s("aaa", 2), s("zzz", 1), plugin, s("bbb", 2)], { serial: 1 });
  assert.deepEqual(index.entries.map((e) => e.id), ["github", "zzz", "aaa", "bbb"]);
});
