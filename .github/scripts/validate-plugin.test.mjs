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
import { MOSS_ICON_RS, allowlistDrift } from "./icon-allowlist.mjs";

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
  const manifest = { name: "js-plugin", version: "1.0.0", entry: "main.bundle.js", global_name: "JsPlugin", capabilities: ["deploy"], network: { hosts: [] } };
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

test("a code plugin declares its network hosts, each named in the README", () => {
  const passes = (edit) => {
    const p = jsPlugin(edit);
    try { return validate(p.dir); } finally { p.cleanup(); }
  };
  const readme = (text) => ({ dir }) => writeFileSync(join(dir, "README.md"), `# js\n\n## Network access\n\n${text}\n\n## Other\n\napi.other.net\n`);
  assert.match(passes(({ manifest }) => delete manifest.network).out, /needs a "network" field/);
  assert.match(passes(({ manifest }) => (manifest.network = { hosts: ["https://api.example.com"] })).out, /is not a host name/);
  assert.match(passes(({ manifest }) => (manifest.network = { hosts: ["*"] })).out, /is not a host name/);
  assert.match(passes(({ manifest }) => (manifest.network = { hostz: [] })).out, /unknown key in "network": "hostz"/);
  assert.match(passes((ctx) => { ctx.manifest.network = { hosts: ["api.other.net"] }; readme("None.")(ctx); }).out, /does not mention api\.other\.net/);
  const ok = passes((ctx) => {
    ctx.manifest.network = { hosts: ["api.example.com", "*.media.example.com"], setting_hosts: ["server"], site: true };
    ctx.manifest.config_schema = { server: "string" };
    readme("- api.example.com and media.example.com: posts.\n- Your server setting.")(ctx);
  });
  assert.equal(ok.ok, true, ok.out);
  for (const [schema, why] of [[{}, /not a setting the manifest declares/], [{ server: "secret" }, /it is secret/]]) {
    assert.match(passes((ctx) => { ctx.manifest.network = { hosts: [], setting_hosts: ["server"] }; ctx.manifest.config_schema = schema; readme("server")(ctx); }).out, why);
  }
  const hidden = passes((ctx) => {
    ctx.manifest.network = { hosts: [], setting_hosts: ["api"] };
    ctx.manifest.contributes = { channel: { setup: { settings: [{ key: "api", type: "string", hidden: true }] } } };
    readme("api")(ctx);
  });
  assert.match(hidden.out, /it is hidden/);
});

test("a built JavaScript plugin passes", () => {
  const p = jsPlugin();
  try {
    assert.equal(validate(p.dir).ok, true);
  } finally {
    p.cleanup();
  }
});

test("a channel that declares a sign-in must export logout", () => {
  const channel = (login, bundle) =>
    jsPlugin(({ dir, manifest }) => {
      manifest.capabilities = ["syndicate"];
      manifest.contributes = { channel: { login } };
      writeFileSync(join(dir, "assets", "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
      writeFileSync(join(dir, "dist", "main.bundle.js"), bundle);
    });
  const iife = (hooks) => `var JsPlugin = (() => ({ ${hooks} }))();`;
  for (const login of [true, "https://example.com/sign-in"]) {
    const without = channel(login, iife("async login() {}"));
    const with_ = channel(login, iife("async login() {}, async logout() {}"));
    try {
      const r = validate(without.dir);
      assert.equal(r.ok, false, r.out);
      assert.match(r.out, /declares a sign-in, but the bundle exports no logout/);
      assert.equal(validate(with_.dir).ok, true, validate(with_.dir).out);
    } finally {
      without.cleanup();
      with_.cleanup();
    }
  }
  const unnamed = jsPlugin(({ dir, manifest }) => {
    manifest.capabilities = ["syndicate"];
    manifest.contributes = { channel: { login: true } };
    delete manifest.global_name;
    writeFileSync(join(dir, "assets", "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  });
  try {
    assert.match(validate(unnamed.dir).out, /names its bundle's global in manifest.global_name/);
  } finally {
    unnamed.cleanup();
  }
  const tokenOnly = channel(undefined, iife("async publish_copy() {}"));
  const throws = channel(true, "throw new Error('boom');");
  try {
    assert.equal(validate(tokenOnly.dir).ok, true, validate(tokenOnly.dir).out);
    assert.match(validate(throws.dir).out, /throws when loaded, so its logout cannot be checked: boom/);
  } finally {
    tokenOnly.cleanup();
    throws.cleanup();
  }
});

test("min_moss_version must be a version moss can read", () => {
  for (const floor of ["whenever", "0.15", ">=0.15.0", "v0.15.0", "0.015.0", " 0.15.0", 15]) {
    const p = jsPlugin(({ manifest }) => (manifest.min_moss_version = floor));
    try {
      const r = validate(p.dir);
      assert.equal(r.ok, false, `${JSON.stringify(floor)} must be refused:\n${r.out}`);
      assert.match(r.out, /min_moss_version .* is not a version moss can read/);
    } finally {
      p.cleanup();
    }
  }
  for (const floor of ["0.15.20", "1.0.0-beta.1", "0.0.0"]) {
    const p = jsPlugin(({ manifest }) => (manifest.min_moss_version = floor));
    try {
      assert.equal(validate(p.dir).ok, true, `${floor} must pass`);
    } finally {
      p.cleanup();
    }
  }
});

test("a JavaScript plugin still needs entry, package.json, a lockfile and its bundle", () => {
  const cases = [
    [({ manifest }) => delete manifest.entry, /global_name belongs to a JavaScript bundle/],
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

test("an icon is one moss draws as it is, and a channel must ship one", () => {
  const plugin = (icon, { channel = true, named = true } = {}) => jsPlugin(({ dir, manifest }) => {
    if (channel) manifest.contributes = { channel: { display_name: "Js" } };
    if (icon === undefined) return;
    if (named) manifest.icon = "icon.svg";
    writeFileSync(join(dir, "assets", "icon.svg"), icon);
  });
  const check = (icon, pattern, opts) => {
    const p = plugin(icon, opts);
    try {
      const r = validate(p.dir);
      if (pattern) {
        assert.equal(r.ok, false, r.out);
        assert.match(r.out, pattern);
      } else {
        assert.equal(r.ok, true, r.out);
      }
    } finally {
      p.cleanup();
    }
  };
  const good = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h24v24H0z"/></svg>';
  const styled = '<svg viewBox="0 0 24 24"><style>.a{fill:red}</style><path class="a" d="M0 0"/></svg>';
  check(good, null);
  check(good, null, { named: false });
  check(undefined, /a channel needs its mark/);
  check(styled, /<style>.*strips/);
  check('<svg viewBox="0 0 24 24"><path class="a" d="M0 0"/></svg>', /class=.*strips/);
  check(styled, /<style>.*strips/, { channel: false, named: false });
  check(undefined, null, { channel: false });
});

test("an exempt plugin's icon is a note, and the exemption fails once its icon draws", () => {
  const withIcon = (icon) => nativePlugin(({ dir, manifest }) => {
    manifest.icon = "icon.svg";
    writeFileSync(join(dir, "assets", "icon.svg"), icon);
  }, "onionpress");
  const png = withIcon('<svg viewBox="0 0 64 64"><image href="data:image/png;base64,AA"/></svg>');
  try {
    const r = validate(png.dir);
    assert.equal(r.ok, true, r.out);
    assert.match(r.out, /onionpress: icon exempt/);
  } finally {
    png.cleanup();
  }
  const vector = withIcon('<svg viewBox="0 0 64 64"><path d="M0 0h64v64H0z"/></svg>');
  try {
    const r = validate(vector.dir);
    assert.equal(r.ok, false, r.out);
    assert.match(r.out, /remove onionpress from ICON_EXEMPT/);
  } finally {
    vector.cleanup();
  }
});

test("the icon allowlists equal moss's own", async (t) => {
  let source;
  try {
    const res = await fetch(MOSS_ICON_RS, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    source = await res.text();
  } catch (err) {
    if (process.env.CI) throw new Error(`could not read moss's icon.rs: ${err.message}`);
    t.skip(`offline: ${err.message}`);
    return;
  }
  assert.deepEqual(allowlistDrift(source), []);
  const withoutMask = source.replace(/"clipPath", "mask",/, '"clipPath",');
  assert.deepEqual(allowlistDrift(withoutMask), ['ALLOWED_TAGS: moss strips "mask", the registry allows it']);
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

// -------------------------------------------------------------- declared --
// No entry and no derivations: the manifest declares what moss reads, and the
// zip is assets/ as it stands.

/** A declared plugin shaped like booking: a block with a script and a stylesheet, public data, a settings form. */
function declaredPlugin(edit = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "validate-test-"));
  const dir = join(root, "declared-fixture");
  mkdirSync(join(dir, "assets"), { recursive: true });
  const manifest = {
    name: "declared-fixture",
    version: "0.1.0",
    contributes: {
      blocks: { thing: { element: "moss-thing", script: "moss-thing.js", stylesheet: "moss-thing.css" } },
      public_data: { keys: ["endpoint"] },
      site_settings: { settings: [{ key: "endpoint", type: "string", label: "Endpoint" }] },
    },
  };
  writeFileSync(join(dir, "README.md"), "# declared\n\n## Network access\n\nNone.\n");
  writeFileSync(join(dir, "assets", "moss-thing.js"), "customElements.define('moss-thing', class extends HTMLElement {});");
  writeFileSync(join(dir, "assets", "moss-thing.css"), "moss-thing { display: block; }");
  edit({ dir, manifest });
  writeFileSync(join(dir, "assets", "manifest.json"), JSON.stringify(manifest));
  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function expectDeclaredFail(edit, pattern) {
  const p = declaredPlugin(edit);
  try {
    const r = validate(p.dir);
    assert.equal(r.ok, false, `expected a failure matching ${pattern}, got:\n${r.out}`);
    assert.match(r.out, pattern);
  } finally {
    p.cleanup();
  }
}

test("a plugin that only declares its components passes, with no build and no package.json", () => {
  const p = declaredPlugin();
  try {
    const r = validate(p.dir);
    assert.equal(r.ok, true, r.out);
  } finally {
    p.cleanup();
  }
});

test("a declared plugin names name and version, and the shared checks apply", () => {
  expectDeclaredFail(({ manifest }) => delete manifest.version, /manifest\.version is required/);
  expectDeclaredFail(({ manifest }) => (manifest.name = "other"), /manifest\.name is "other" but the directory/);
});

test("a declared plugin needs at least one contributes key", () => {
  expectDeclaredFail(({ manifest }) => delete manifest.contributes, /declares nothing/);
  expectDeclaredFail(({ manifest }) => (manifest.contributes = {}), /declares nothing/);
});

test("a declared plugin has nothing that builds, and no derivations", () => {
  expectDeclaredFail(({ dir }) => mkdirSync(join(dir, "native")), /native\/ directory/);
  expectDeclaredFail(({ dir }) => writeFileSync(join(dir, "package.json"), "{}"), /package\.json/);
  expectDeclaredFail(({ dir }) => writeFileSync(join(dir, "package-lock.json"), "{}"), /package-lock\.json/);
  expectDeclaredFail(({ manifest }) => (manifest.global_name = "X"), /global_name belongs to a JavaScript bundle/);
  expectDeclaredFail(({ manifest }) => (manifest.contributes.derivations = {}), /contributes\.derivations must be absent/);
});

test("an entry that is present but empty is a JavaScript plugin missing its entry", () => {
  expectDeclaredFail(({ manifest }) => (manifest.entry = ""), /manifest\.entry is required/);
});

test("every file a block or the icon names exists inside assets/", () => {
  expectDeclaredFail(({ dir }) => rmSync(join(dir, "assets", "moss-thing.js")), /block "thing" script "moss-thing\.js" is not in assets\//);
  expectDeclaredFail(({ dir }) => rmSync(join(dir, "assets", "moss-thing.css")), /block "thing" stylesheet "moss-thing\.css" is not in assets\//);
  expectDeclaredFail(({ manifest }) => (manifest.contributes.blocks.thing.script = "../README.md"), /script "\.\.\/README\.md" is not in assets\//);
  expectDeclaredFail(({ manifest }) => (manifest.icon = "icon.svg"), /icon "icon\.svg" is not in assets\//);
});

test("a native-shaped plugin that loses its derivations declares nothing", () => {
  expectFail(({ manifest }) => delete manifest.contributes.derivations, /declares nothing/);
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
