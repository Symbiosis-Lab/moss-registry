// Tests for the PR validator, run as the CLI it is in CI.
//
//   node --test .github/scripts/

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const validator = join(here, "validate-plugin.mjs");
export const FIXTURE = join(here, "fixtures", "native-fixture");

/** Run the validator on a directory; cwd is a non-repo so no release tags exist. */
function validate(dir) {
  const r = spawnSync("node", [validator, dir], { encoding: "utf8", cwd: tmpdir() });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
}

/**
 * A scratch copy of the native fixture, named `id`. `edit({ dir, manifest })`
 * may mutate the manifest object (written back) or the files.
 */
function nativePlugin(edit = () => {}, id = "native-fixture") {
  const root = mkdtempSync(join(tmpdir(), "validate-test-"));
  const dir = join(root, id);
  cpSync(FIXTURE, dir, { recursive: true });
  const path = join(dir, "assets", "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.name = id;
  edit({ dir, manifest, artifact: manifest.contributes?.derivations?.["hello-text"]?.run?.artifact?.[0] });
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function expectFail(edit, pattern, id) {
  const p = nativePlugin(edit, id);
  try {
    const r = validate(p.dir);
    assert.equal(r.ok, false, `expected a failure matching ${pattern}, got:\n${r.out}`);
    assert.match(r.out, pattern);
  } finally {
    p.cleanup();
  }
}

/** A minimal JavaScript plugin, built (dist/ present). */
function jsPlugin(edit = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "validate-test-"));
  const dir = join(root, "js-plugin");
  mkdirSync(join(dir, "assets"), { recursive: true });
  mkdirSync(join(dir, "dist"));
  const manifest = { name: "js-plugin", version: "1.0.0", entry: "main.bundle.js", global_name: "JsPlugin", capabilities: ["deploy"] };
  const files = {
    "package.json": { name: "@x/js-plugin", version: "1.0.0" },
    "package-lock.json": { lockfileVersion: 3 },
  };
  writeFileSync(join(dir, "README.md"), "# js\n\n## Network access\n\nNone.\n");
  writeFileSync(join(dir, "dist", "main.bundle.js"), "var JsPlugin = {};");
  edit({ dir, manifest, files });
  writeFileSync(join(dir, "assets", "manifest.json"), JSON.stringify(manifest));
  for (const [name, body] of Object.entries(files)) if (body) writeFileSync(join(dir, name), JSON.stringify(body));
  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// ------------------------------------------------------------ JavaScript --

test("a built JavaScript plugin passes", () => {
  const p = jsPlugin();
  try {
    assert.equal(validate(p.dir).ok, true);
  } finally {
    p.cleanup();
  }
});

test("a JavaScript plugin still needs entry, package.json, a lockfile and its bundle", () => {
  const cases = [
    [({ manifest }) => delete manifest.entry, /no "entry" and no contributes\.derivations/],
    [({ files }) => (files["package.json"] = null), /missing package\.json/],
    [({ files }) => (files["package-lock.json"] = null), /missing package-lock\.json/],
    [({ files }) => (files["package.json"].version = "2.0.0"), /package\.json version "2\.0\.0" != manifest version/],
    [({ manifest }) => (manifest.entry = "absent.js"), /dist\/absent\.js not found/],
    [({ manifest }) => (manifest.global_name = "Other"), /does not mention global_name/],
  ];
  for (const [edit, pattern] of cases) {
    const p = jsPlugin(edit);
    try {
      const r = validate(p.dir);
      assert.equal(r.ok, false, String(pattern));
      assert.match(r.out, pattern);
    } finally {
      p.cleanup();
    }
  }
});

test("a JavaScript plugin may not also carry a native program", () => {
  const withArtifact = ({ manifest }) => {
    manifest.contributes = { derivations: { d: { run: { artifact: [{ kind: "download", platform: "darwin-arm64", archive_format: "zip", executable: "x" }] } } } };
  };
  let p = jsPlugin(withArtifact);
  try {
    const r = validate(p.dir);
    assert.equal(r.ok, false);
    assert.match(r.out, /either JavaScript or a native program/);
  } finally {
    p.cleanup();
  }
  p = jsPlugin(({ dir }) => mkdirSync(join(dir, "native")));
  try {
    assert.match(validate(p.dir).out, /has a native\/ directory and an "entry"/);
  } finally {
    p.cleanup();
  }
});

// ---------------------------------------------------------------- native --

test("the fixture native plugin passes without any build, and flags itself for review", () => {
  const p = nativePlugin();
  try {
    const r = validate(p.dir);
    assert.equal(r.ok, true, r.out);
    assert.match(r.out, /REVIEWER: read native\//);
  } finally {
    p.cleanup();
  }
});

test("a native plugin needs no package.json or lockfile (none is in the fixture)", () => {
  const p = nativePlugin();
  try {
    assert.doesNotMatch(validate(p.dir).out, /package/);
  } finally {
    p.cleanup();
  }
});

test("a native plugin must have native/ and a Cargo.toml", () => {
  expectFail(({ dir }) => rmSync(join(dir, "native"), { recursive: true }), /no native\/ directory/);
  expectFail(({ dir }) => rmSync(join(dir, "native", "Cargo.toml")), /missing native\/Cargo\.toml/);
});

test("Cargo.toml's version must equal the manifest's", () => {
  expectFail(({ dir }) => writeFileSync(join(dir, "native", "Cargo.toml"), '[package]\nname = "x"\nversion = "9.9.9"\n'), /Cargo\.toml version "9\.9\.9" != manifest version "0\.1\.0"/);
  expectFail(({ dir }) => writeFileSync(join(dir, "native", "Cargo.toml"), '[package]\nname = "x"\nversion.workspace = true\n'), /no literal \[package\] version/);
  expectFail(({ dir }) => writeFileSync(join(dir, "native", "Cargo.toml"), '[dependencies]\nversion = "0.1.0"\n'), /no literal \[package\] version/);
});

test("no entry and no derivations is not a plugin", () => {
  expectFail(({ manifest }) => delete manifest.contributes, /no "entry" and no contributes\.derivations/);
  expectFail(({ manifest }) => (manifest.contributes = { derivations: {} }), /no "entry" and no contributes\.derivations/);
});

test("a native plugin may not carry JavaScript-only fields", () => {
  expectFail(({ manifest }) => (manifest.global_name = "X"), /global_name belongs to a JavaScript bundle/);
  expectFail(({ manifest }) => (manifest.entry = "main.js"), /either JavaScript or a native program|has a native\/ directory and an "entry"/);
});

test("each artifact needs kind download, a known platform, a format and an inside-the-archive executable", () => {
  expectFail(({ artifact }) => (artifact.kind = "system"), /kind must be "download"/);
  expectFail(({ artifact }) => (artifact.platform = "plan9-mips"), /unknown platform "plan9-mips"/);
  expectFail(({ artifact }) => delete artifact.platform, /unknown platform undefined/);
  expectFail(({ artifact }) => (artifact.archive_format = "rar"), /archive_format must be one of tar\.gz, zip/);
  expectFail(({ artifact }) => delete artifact.archive_format, /archive_format must be one of/);
  expectFail(({ artifact }) => delete artifact.executable, /executable must be a relative path/);
  expectFail(({ artifact }) => (artifact.executable = "/usr/bin/prog"), /executable must be a relative path/);
  expectFail(({ artifact }) => (artifact.executable = "../prog"), /executable must be a relative path/);
  expectFail(({ artifact }) => (artifact.executable = "a\\b"), /executable must be a relative path/);
});

test("a derivation with no artifact list fails", () => {
  expectFail(({ manifest }) => delete manifest.contributes.derivations["hello-text"].run.artifact, /run\.artifact must list the downloads/);
  expectFail(({ manifest }) => (manifest.contributes.derivations["hello-text"].run.artifact = []), /run\.artifact must list the downloads/);
});

test("url and sha256 are never written in source", () => {
  expectFail(({ artifact }) => (artifact.url = "https://example.invalid/x.tar.gz"), /must not carry "url" in source/);
  expectFail(({ artifact }) => (artifact.sha256 = "0".repeat(64)), /must not carry "sha256" in source/);
});

test("a platform listed twice in one derivation fails", () => {
  expectFail(({ artifact, manifest }) => manifest.contributes.derivations["hello-text"].run.artifact.push({ ...artifact }), /platform darwin-arm64 is listed twice/);
});

test("derivations sharing a platform must share its archive format", () => {
  expectFail(({ manifest, artifact }) => {
    const second = JSON.parse(JSON.stringify(manifest.contributes.derivations["hello-text"]));
    second.run.artifact[0] = { ...artifact, archive_format: "zip" };
    manifest.contributes.derivations.other = second;
  }, /differs from "tar\.gz" declared for darwin-arm64/);
});

test("every declared platform needs its build script", () => {
  expectFail(({ dir }) => rmSync(join(dir, "native", "build-darwin-arm64.sh")), /missing native\/build-darwin-arm64\.sh/);
});

test("the shared checks still apply to a native plugin", () => {
  expectFail(({ manifest }) => (manifest.name = "other"), /manifest\.name is "other" but the directory/);
  expectFail(({ manifest }) => (manifest.version = "1.0"), /not valid semver/);
  expectFail(({ dir }) => rmSync(join(dir, "README.md")), /missing README\.md/);
  expectFail(({ dir }) => writeFileSync(join(dir, "README.md"), "# x\n"), /Network access/);
  expectFail(() => {}, /ids may not start with "moss-"/, "moss-native");
  expectFail(({ manifest }) => (manifest.type = "theme"), /manifest\.type is "theme"/);
});

test("version monotonicity applies: a version below a released tag fails", () => {
  // The validator reads tags from the cwd's repository.
  const repo = mkdtempSync(join(tmpdir(), "validate-tags-"));
  const git = (...a) => spawnSync("git", a, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x");
  git("tag", "native-fixture-v0.2.0");
  const p = nativePlugin();
  try {
    const r = spawnSync("node", [validator, p.dir], { encoding: "utf8", cwd: repo });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /BELOW the latest released 0\.2\.0/);
  } finally {
    p.cleanup();
    rmSync(repo, { recursive: true, force: true });
  }
});
