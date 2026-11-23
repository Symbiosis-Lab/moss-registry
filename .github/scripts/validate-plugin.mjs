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
import { runInNewContext } from "node:vm";
import {
  ID_RE,
  SEMVER_RE,
  MOSS_VERSION_RE,
  RESERVED_IDS,
  cmpSemver,
  parseReleaseTag,
  classifyRequirement,
  REQUIRES_GRAMMAR,
  NATIVE_PLATFORMS,
  ARCHIVE_FORMATS,
  buildScriptFor,
  derivationArtifacts,
  pluginKind,
  networkProblems,
} from "./registry-rules.mjs";
import { ICON_ATTRS, ICON_EXEMPT, ICON_TAGS } from "./icon-allowlist.mjs";


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

// The shape decides the kind (registry-rules.mjs `pluginKind`).
const kind = manifest === null ? "js" : pluginKind(manifest);

if (manifest) {
  for (const field of kind === "js" ? ["name", "version", "entry"] : ["name", "version"]) {
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
  if (manifest.min_moss_version !== undefined && !MOSS_VERSION_RE.test(String(manifest.min_moss_version))) {
    fail(
      `${id}: manifest.min_moss_version ${JSON.stringify(manifest.min_moss_version)} is not a version moss can read (write it like "0.15.20"); moss refuses to run a plugin whose floor it cannot read`,
    );
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

  if (kind === "native") validateNative();
  else if (kind === "declared") validateDeclared();
  else validateJsPackage();

  validateIcon();
  validateNewsletterService();

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

/**
 * moss draws a plugin's icon in the catalog and, for a channel, in the channel
 * rail, falling back to a letter without one; markup moss strips draws wrong
 * (icon-allowlist.mjs).
 * The file defaults to icon.svg, as publish.yml reads it.
 */
function validateIcon() {
  const file = manifest.icon ?? "icon.svg";
  if (typeof file !== "string" || !isRelativeInside(file) || !existsSync(join(dir, "assets", file))) {
    if (manifest.contributes?.channel) fail(`${id}: a channel needs its mark: put icon.svg in assets/, or name another file there in manifest.icon`);
    else if (manifest.icon !== undefined) fail(`${id}: icon "${file}" is not in assets/ — the zip is assets/, so every file a manifest names must be there`);
    return;
  }
  const svg = readFileSync(join(dir, "assets", file), "utf8");
  const stripped = [];
  for (const [, tag, attrs] of svg.matchAll(/<([A-Za-z][\w:-]*)([^>]*)>/g)) {
    if (!ICON_TAGS.has(tag)) stripped.push(`<${tag}>`);
    for (const [, attr] of attrs.matchAll(/([A-Za-z_:][\w:.-]*)\s*=/g)) {
      if (!ICON_ATTRS.has(attr)) stripped.push(`${attr}=`);
    }
  }
  const exempt = ICON_EXEMPT.get(id);
  if (exempt === undefined) {
    for (const what of stripped) fail(`${id}: ${file} uses ${what}, which moss strips from an icon`);
  } else if (stripped.length) {
    note(`${id}: icon exempt from the icon check: ${exempt}`);
  } else {
    fail(`${id}: ${file} is now an icon moss draws: remove ${id} from ICON_EXEMPT in icon-allowlist.mjs`);
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

/** The declared half: no code of its own, so nothing builds and every named file ships as it stands. */
function validateDeclared() {
  const contributes = manifest.contributes;
  if (!contributes || typeof contributes !== "object" || Array.isArray(contributes) || Object.keys(contributes).length === 0) {
    fail(`${id}: no "entry", no derivations and nothing under contributes — it declares nothing`);
  } else if (contributes.derivations !== undefined) {
    fail(`${id}: contributes.derivations must be absent, or declare the program it runs`);
  }
  if (manifest.global_name !== undefined) {
    fail(`${id}: manifest.global_name belongs to a JavaScript bundle, but this plugin has no "entry"`);
  }
  for (const stray of ["native", "package.json", "package-lock.json"]) {
    if (existsSync(join(dir, stray))) {
      fail(`${id}: has ${stray === "native" ? "a native/ directory" : stray} but declares no entry or program — nothing builds a declared plugin; it ships assets/ as it is`);
    }
  }
  const named = [];
  for (const [name, block] of Object.entries(contributes?.blocks ?? {})) {
    for (const field of ["script", "stylesheet"]) {
      if (block?.[field] !== undefined) named.push([`block "${name}" ${field}`, block[field]]);
    }
  }
  for (const [what, file] of named) {
    if (!isRelativeInside(file) || !existsSync(join(dir, "assets", file))) {
      fail(`${id}: ${what} "${file}" is not in assets/ — the zip is assets/, so every file a manifest names must be there`);
    }
  }
}

/**
 * The rules moss applies when it reads contributes.newsletter_service, so a
 * manifest moss would refuse is never listed.
 */
function validateNewsletterService() {
  const service = manifest.contributes?.newsletter_service;
  if (service === undefined) return;
  const at = `${id}: contributes.newsletter_service`;
  const https = (field, address) => {
    let ok = false;
    try {
      const u = new URL(address);
      ok = u.protocol === "https:" && u.host !== "";
    } catch {}
    if (!ok) fail(`${at}.${field} ${JSON.stringify(address)} is not an https address`);
  };
  const key = service.key ?? {};
  https("key.url", key.url);
  for (const field of ["webhooks_url", "senders_url"]) {
    if (service[field] !== undefined) https(field, service[field]);
  }
  if (typeof key.prefix !== "string" || !/^[\x21-\x7e]{1,10}$/.test(key.prefix)) {
    fail(`${at}.key.prefix is 1 to 10 printable ASCII characters`);
  } else if (!Number.isInteger(key.length) || key.length <= key.prefix.length || key.length > 512) {
    fail(`${at}.key.length is longer than the prefix and at most 512`);
  }
  if (typeof key.permission !== "string") fail(`${at}.key.permission is the service's word for the access the key needs`);
  const steps = service.steps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 5 || !steps.every((s) => typeof s === "string")) {
    fail(`${at}.steps holds 1 to 5 steps`);
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
  for (const [name, d] of Object.entries(manifest.contributes.derivations)) {
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
  const section = readme.match(/^##\s+Network access\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  if (!section) {
    fail(`${id}: README.md needs a "## Network access" section listing every domain the plugin contacts (write "None" if it makes no requests)`);
  } else if (manifest?.entry) {
    for (const problem of networkProblems(manifest, section[1])) fail(`${id}: ${problem}`);
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

    // Sign out runs the plugin's `logout`; moss treats a missing one as
    // nothing to do, so a channel with sign-in and no logout ships with a
    // sign-out that leaves the plugin's own session behind.
    const channel = manifest.contributes?.channel;
    if ((channel?.login ?? channel?.requires_login) && !manifest.global_name) {
      fail(`${id}: a channel with sign-in names its bundle's global in manifest.global_name, so its logout can be checked`);
    } else if (channel?.login ?? channel?.requires_login) {
      const hooks = loadedHooks(bundle, manifest.global_name);
      if (hooks.error) fail(`${id}: the bundle throws when loaded, so its logout cannot be checked: ${hooks.error}`);
      else if (typeof hooks.instance?.logout !== "function") {
        fail(`${id}: contributes.channel.login declares a sign-in, but the bundle exports no logout`);
      }
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

/** What moss's loader reads: the bundle evaluated, then the global it names. The sandbox holds the web globals
 * moss's engine defines, so a bundle that builds an encoder at load is not mistaken for a broken one. */
function loadedHooks(bundle, globalName) {
  const { TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa, setTimeout, clearTimeout, crypto, console } = globalThis;
  const sandbox = { TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa, setTimeout, clearTimeout, crypto, console };
  sandbox.window = sandbox;
  try {
    runInNewContext(`${bundle}\n;globalThis.__moss_loaded = ${globalName};`, sandbox, { timeout: 2000 });
    return { instance: sandbox.__moss_loaded };
  } catch (e) {
    return { error: String(e?.message ?? e) };
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
