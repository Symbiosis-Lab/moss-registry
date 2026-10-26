#!/usr/bin/env node
// Validate one plugin directory against the registry's submission rules.
// A JavaScript plugin is validated AFTER `npm run build` in that directory —
// several checks read dist/. A native plugin (no `entry`; a program moss
// downloads) needs no build to be validated.
//
//   node .github/scripts/validate-plugin.mjs <plugin-dir>
//
// Exits non-zero with one line per failure. Node builtins only, so CI can run
// it without installing anything.

import { readFileSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  ID_RE,
  SEMVER_RE,
  RESERVED_IDS,
  cmpSemver,
  parseReleaseTag,
  classifyRequirement,
  REQUIRES_GRAMMAR,
  NATIVE_PLATFORMS,
  ARCHIVE_FORMATS,
  buildScriptFor,
  derivationArtifacts,
} from "./registry-rules.mjs";

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const note = (m) => notes.push(m);

const dir = resolve(process.argv[2] ?? "");
if (!dir || !existsSync(dir)) {
  console.error(`validate-plugin: no such directory: ${process.argv[2]}`);
  process.exit(2);
}
const id = basename(dir);

/** Parse JSON with a useful error instead of a bare SyntaxError. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`${path}: not valid JSON — ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------- manifest --
const manifestPath = join(dir, "assets", "manifest.json");
if (!existsSync(manifestPath)) {
  fail(`${id}: missing assets/manifest.json — a plugin directory must have one`);
}
const manifest = existsSync(manifestPath) ? readJson(manifestPath) : null;

// A plugin is native exactly when its manifest has no `entry`: moss then has
// no JavaScript to load and runs what `contributes.derivations` declares.
const native = manifest !== null && manifest.entry === undefined;

if (manifest) {
  for (const field of native ? ["name", "version"] : ["name", "version", "entry"]) {
    if (typeof manifest[field] !== "string" || !manifest[field]) {
      fail(`${id}: manifest.${field} is required and must be a non-empty string`);
    }
  }

  if (manifest.name !== id) {
    fail(`${id}: manifest.name is "${manifest.name}" but the directory is "${id}" — they must match`);
  }
  if (!ID_RE.test(id)) {
    fail(`${id}: invalid id — lowercase letters, digits and hyphens only, 3-40 chars, no leading/trailing hyphen`);
  }
  if (id.startsWith("moss-")) {
    fail(`${id}: ids may not start with "moss-" (reserved for first-party)`);
  }
  if (RESERVED_IDS.has(id)) {
    fail(`${id}: "${id}" is a reserved id`);
  }
  if (manifest.version && !SEMVER_RE.test(manifest.version)) {
    fail(`${id}: manifest.version "${manifest.version}" is not valid semver`);
  }

  // Validation is not additionalProperties:false, so a misspelled optional
  // key silently means false and the author never learns. Type-check the two
  // booleans the index re-emits for catalog presentation.
  for (const field of ["preview", "requires_stack"]) {
    if (manifest[field] !== undefined && typeof manifest[field] !== "boolean") {
      fail(`${id}: manifest.${field} must be a boolean when present, got ${JSON.stringify(manifest[field])}`);
    }
  }

  // The directory decides which kind of package this is; the manifest may
  // restate it so the artifact is self-describing once it leaves the repo, but
  // it may not disagree. Two declarations that can differ are worse than one.
  if (manifest.type !== undefined && manifest.type !== "plugin") {
    fail(
      `${id}: manifest.type is ${JSON.stringify(manifest.type)} but this is under plugins/, which publishes plugins. A theme lives in themes/<id>/ and is never executed.`,
    );
  }

  if (native) {
    validateNative();
  } else {
    validateJsPackage();
  }

  // Version must move forward relative to what has already been released.
  let tags = [];
  try {
    tags = execFileSync("git", ["tag", "-l", `${id}-v*`], { encoding: "utf8" })
      .split("\n").map((t) => t.trim()).filter(Boolean);
  } catch {
    note(`${id}: could not list git tags; skipping the version-bump check`);
  }
  const released = tags
    .map((t) => parseReleaseTag(t))
    .filter((p) => p && p.id === id)
    .map((p) => p.version)
    .sort(cmpSemver);
  const latest = released[released.length - 1];
  if (latest && manifest.version) {
    const rel = cmpSemver(manifest.version, latest);
    if (rel < 0) {
      fail(`${id}: version ${manifest.version} is BELOW the latest released ${latest} — versions must never move backwards`);
    } else if (rel === 0) {
      // Not an error: publish.yml is idempotent and skips an existing tag, so a
      // docs-only change can merge without cutting a release.
      note(`${id}: version ${manifest.version} matches the latest release — merging will NOT publish a new version. Bump it if you intended to ship a change.`);
    }
  }
}

/** The JavaScript half: package.json agrees with the manifest, and a lockfile is committed. */
function validateJsPackage() {
  // package.json must agree, or the published zip and the npm package drift.
  const pkgPath = join(dir, "package.json");
  const pkg = existsSync(pkgPath) ? readJson(pkgPath) : null;
  if (!pkg) {
    fail(`${id}: missing package.json`);
  } else {
    if (pkg.version !== manifest.version) {
      fail(`${id}: package.json version "${pkg.version}" != manifest version "${manifest.version}"`);
    }
    const deps = pkg.dependencies ?? {};
    const devDeps = pkg.devDependencies ?? {};
    for (const [name, range] of Object.entries({ ...deps, ...devDeps })) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        fail(`${id}: dependency "${name}" uses "${range}" — workspace protocol does not resolve outside the monorepo; pin a published version`);
      }
    }
    if (Object.keys(deps).length > 0) {
      note(`${id}: has ${Object.keys(deps).length} runtime dependency/ies — they are bundled into the shipped artifact and must be reviewed`);
    }
  }

  if (!existsSync(join(dir, "package-lock.json"))) {
    fail(`${id}: missing package-lock.json — commit it so CI installs are reproducible`);
  }

  if (manifest.contributes?.derivations && derivationArtifacts(manifest).some(({ artifact }) => artifact.kind === "download")) {
    fail(
      `${id}: has an "entry" and also derivations that download a program. A plugin is either JavaScript or a native program, not both: the publisher builds one or the other. Split it into two plugins, or drop "entry".`,
    );
  }
  if (existsSync(join(dir, "native"))) {
    fail(`${id}: has a native/ directory and an "entry". A native plugin has no entry; a JavaScript plugin has no native/.`);
  }
}

/** The text of `version = "x"` in Cargo.toml's [package] table, or null. */
function cargoPackageVersion(text) {
  const table = text.split(/^\[/m).find((t) => t.startsWith("package]"));
  return table?.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

/** A relative path with no way out of the archive. */
function isRelativeInside(p) {
  return (
    typeof p === "string" &&
    p !== "" &&
    !p.startsWith("/") &&
    !/^[A-Za-z]:/.test(p) &&
    !p.includes("\\") &&
    !p.split("/").some((part) => part === ".." || part === "")
  );
}

/** The native half: a manifest that declares downloads, the source that builds them, a script per platform. */
function validateNative() {
  if (manifest.global_name !== undefined) {
    fail(`${id}: manifest.global_name belongs to a JavaScript bundle, but this plugin has no "entry"`);
  }

  const derivations = manifest.contributes?.derivations;
  if (!derivations || typeof derivations !== "object" || Array.isArray(derivations) || Object.keys(derivations).length === 0) {
    fail(`${id}: no "entry" and no contributes.derivations — a plugin needs JavaScript to load or a program to run`);
    return;
  }

  const nativeDir = join(dir, "native");
  if (!existsSync(nativeDir)) {
    fail(`${id}: contributes.derivations but no native/ directory — the registry builds the program from source under native/`);
  } else {
    const cargoPath = join(nativeDir, "Cargo.toml");
    if (!existsSync(cargoPath)) {
      fail(`${id}: missing native/Cargo.toml`);
    } else {
      const cargoVersion = cargoPackageVersion(readFileSync(cargoPath, "utf8"));
      if (cargoVersion === null) {
        fail(`${id}: native/Cargo.toml has no literal [package] version`);
      } else if (cargoVersion !== manifest.version) {
        fail(`${id}: native/Cargo.toml version "${cargoVersion}" != manifest version "${manifest.version}"`);
      }
    }
  }

  const formatByPlatform = new Map();
  for (const [name, d] of Object.entries(derivations)) {
    const where = `${id}: derivation "${name}"`;
    const artifacts = d?.run?.artifact;
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      fail(`${where}: run.artifact must list the downloads the registry will build`);
      continue;
    }
    const seen = new Set();
    artifacts.forEach((a, i) => {
      const at = `${where} artifact[${i}]`;
      if (!a || typeof a !== "object") {
        fail(`${at}: must be an object`);
        return;
      }
      if (a.kind !== "download") fail(`${at}: kind must be "download", got ${JSON.stringify(a.kind)}`);
      if (!NATIVE_PLATFORMS.includes(a.platform)) {
        fail(`${at}: unknown platform ${JSON.stringify(a.platform)} (known: ${NATIVE_PLATFORMS.join(", ")})`);
      } else if (seen.has(a.platform)) {
        fail(`${at}: platform ${a.platform} is listed twice in this derivation`);
      } else {
        seen.add(a.platform);
      }
      if (!ARCHIVE_FORMATS.includes(a.archive_format)) {
        fail(`${at}: archive_format must be one of ${ARCHIVE_FORMATS.join(", ")}, got ${JSON.stringify(a.archive_format)}`);
      } else if (NATIVE_PLATFORMS.includes(a.platform)) {
        // One archive per platform is built, so derivations that share a
        // platform share its format.
        const first = formatByPlatform.get(a.platform);
        if (first === undefined) formatByPlatform.set(a.platform, a.archive_format);
        else if (first !== a.archive_format) {
          fail(`${at}: archive_format "${a.archive_format}" differs from "${first}" declared for ${a.platform} elsewhere — one archive is built per platform`);
        }
      }
      if (!isRelativeInside(a.executable)) {
        fail(`${at}: executable must be a relative path inside the archive (no leading /, no ".."), got ${JSON.stringify(a.executable)}`);
      }
      for (const key of ["url", "sha256"]) {
        if (a[key] !== undefined) {
          fail(`${at}: must not carry "${key}" in source — CI fills it in from the archive it builds, so a hand-written one could never match what ships`);
        }
      }
    });
  }

  for (const platform of formatByPlatform.keys()) {
    const script = join(nativeDir, buildScriptFor(platform));
    if (!existsSync(script)) {
      fail(`${id}: missing native/${buildScriptFor(platform)} — CI builds ${platform} only by running it`);
    }
  }
  note(`${id}: native plugin (${[...formatByPlatform.keys()].join(", ")}) — REVIEWER: read native/ and every dependency in its lockfile; it runs as a native program on users' machines`);
}

// ------------------------------------------------------------------ README --
const readmePath = join(dir, "README.md");
if (!existsSync(readmePath)) {
  fail(`${id}: missing README.md`);
} else {
  const readme = readFileSync(readmePath, "utf8");
  if (!/^##\s+Network access\s*$/im.test(readme)) {
    fail(`${id}: README.md needs a "## Network access" section listing every domain the plugin contacts (write "None" if it makes no requests)`);
  }
}

// ------------------------------------------------------------------ bundle --
if (manifest?.entry) {
  const bundlePath = join(dir, "dist", manifest.entry);
  if (!existsSync(bundlePath)) {
    fail(`${id}: dist/${manifest.entry} not found — run "npm run build" first (dist/ is gitignored; this validator runs after a build)`);
  } else {
    const bundle = readFileSync(bundlePath, "utf8");

    // moss loads the bundle as an IIFE and reads the global it assigns.
    if (manifest.global_name && !bundle.includes(manifest.global_name)) {
      fail(`${id}: bundle does not mention global_name "${manifest.global_name}" — it must match the esbuild --global-name`);
    }
    // The QuickJS engine has no module loader and no Tauri internals.
    if (/[^.\w]import\s*\(/.test(bundle)) {
      fail(`${id}: bundle contains a dynamic import() — the plugin engine cannot resolve modules at runtime`);
    }
    if (bundle.includes("__TAURI_INTERNALS__")) {
      fail(`${id}: bundle references __TAURI_INTERNALS__ — use the moss-api SDK instead`);
    }

    // Host capabilities must be declared. This is the static half of the
    // execute_binary gate: undeclared use is rejected here.
    const requires = Array.isArray(manifest.requires) ? manifest.requires : [];
    const classified = requires.map((cap) => [cap, classifyRequirement(cap)]);
    const granted = classified.filter(([, c]) => c.kind !== "unknown");
    const blanket = classified.some(([, c]) => c.kind === "blanket");
    const usesExecuteBinary = bundle.includes("execute_binary");
    if (usesExecuteBinary && granted.length === 0) {
      fail(`${id}: bundle calls execute_binary but the manifest grants no binary — declare each one it runs, e.g. requires: ["execute_binary:git"]`);
    }
    if (usesExecuteBinary) {
      const named = granted.filter(([, c]) => c.kind === "named").map(([, c]) => c.binary);
      // A named grant is still native execution, so it is still reviewed. What
      // changes is that the reviewer is told which binaries, not just that.
      note(
        named.length > 0 && !blanket
          ? `${id}: runs native binaries (${named.join(", ")}) — REVIEWER: confirm the PR justifies each`
          : `${id}: uses execute_binary (arbitrary native processes) — REVIEWER: confirm the PR justifies it`,
      );
    }
    if (blanket) {
      note(`${id}: declares the blanket execute_binary, which grants every binary — name each one instead, e.g. "execute_binary:git"`);
    }
    if (granted.length > 0 && !usesExecuteBinary) {
      note(`${id}: declares execute_binary but the bundle does not appear to use it — drop the declaration if it is not needed`);
    }
    for (const [cap, c] of classified) {
      if (c.kind === "unknown") {
        fail(`${id}: unknown entry in requires: "${cap}" (recognized: ${REQUIRES_GRAMMAR})`);
      }
    }
  }
}

// ------------------------------------------------------------------ report --
for (const n of notes) console.log(`::warning::${n}`);
if (failures.length === 0) {
  console.log(`${id}: OK`);
  process.exit(0);
}
for (const f of failures) console.log(`::error::${f}`);
console.error(`\n${id}: ${failures.length} validation failure(s)`);
process.exit(1);
