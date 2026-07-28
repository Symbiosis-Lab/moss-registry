#!/usr/bin/env node
// Validate one plugin directory against the registry's submission rules.
// Run AFTER `npm run build` in that directory — several checks read dist/.
//
//   node .github/scripts/validate-plugin.mjs <plugin-dir>
//
// Exits non-zero with one line per failure. Node builtins only, so CI can run
// it without installing anything.

import { readFileSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { ID_RE, SEMVER_RE, RESERVED_IDS, cmpSemver, parseReleaseTag } from "./registry-rules.mjs";

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

if (manifest) {
  for (const field of ["name", "version", "entry"]) {
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
    const usesExecuteBinary = bundle.includes("execute_binary");
    if (usesExecuteBinary && !requires.includes("execute_binary")) {
      fail(`${id}: bundle calls execute_binary but the manifest does not declare requires: ["execute_binary"]`);
    }
    if (usesExecuteBinary) {
      note(`${id}: uses execute_binary (arbitrary native processes) — REVIEWER: confirm the PR justifies it`);
    }
    if (requires.includes("execute_binary") && !usesExecuteBinary) {
      note(`${id}: declares execute_binary but the bundle does not appear to use it — drop the declaration if it is not needed`);
    }
    for (const cap of requires) {
      if (cap !== "execute_binary") {
        fail(`${id}: unknown entry in requires: "${cap}" (recognized: execute_binary)`);
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
