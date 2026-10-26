// Tests for scripts/pack-native-plugin on the fixture plugin: the build, the
// archive checks, the fill-in of url and sha256, and the release zip.
//
//   node --test .github/scripts/

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packer = join(here, "..", "..", "scripts", "pack-native-plugin");
const FIXTURE = join(here, "fixtures", "native-fixture");
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Pack a scratch copy of the fixture. --skip-run: the fixture's platform is not this host's on CI. */
function pack(edit = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "pack-test-"));
  const dir = join(root, "native-fixture");
  cpSync(FIXTURE, dir, { recursive: true });
  edit(dir);
  const out = join(root, "out");
  const r = spawnSync("python3", [packer, dir, "--out", out, "--repo", "acme/registry", "--skip-run"], { encoding: "utf8" });
  return { r, out, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const build = (dir) => join(dir, "native", "build-darwin-arm64.sh");
const sedBuild = (dir, from, to) => writeFileSync(build(dir), readFileSync(build(dir), "utf8").replace(from, to));

test("packing writes the archive, the release zip and the icon, with url and sha256 filled in", () => {
  const p = pack();
  try {
    assert.equal(p.r.status, 0, p.r.stderr);
    assert.deepEqual(readdirSync(p.out).sort(), [
      "native-fixture-0.1.0-darwin-arm64.tar.gz",
      "native-fixture-0.1.0-icon.svg",
      "native-fixture-0.1.0.zip",
    ]);
    const zip = join(p.out, "native-fixture-0.1.0.zip");
    const listing = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(Boolean).sort();
    assert.deepEqual(listing, ["README.md", "icon.svg", "manifest.json"]);
    const manifest = JSON.parse(execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8" }));
    const a = manifest.contributes.derivations["hello-text"].run.artifact[0];
    assert.equal(a.url, "https://github.com/acme/registry/releases/download/native-fixture-v0.1.0/native-fixture-0.1.0-darwin-arm64.tar.gz");
    assert.equal(a.sha256, sha(readFileSync(join(p.out, "native-fixture-0.1.0-darwin-arm64.tar.gz"))));
    assert.equal(a.executable, "native-fixture/native-fixture");
  } finally {
    p.cleanup();
  }
});

test("the release zip is byte-identical when the same archive is packed twice", () => {
  const p = pack();
  try {
    const zip = join(p.out, "native-fixture-0.1.0.zip");
    const first = sha(readFileSync(zip));
    // Re-pack the same archive: the fixture's tarball varies by mtime, so pin it.
    const again = mkdtempSync(join(tmpdir(), "pack-test-"));
    const dir = join(again, "native-fixture");
    cpSync(FIXTURE, dir, { recursive: true });
    const archive = join(p.out, "native-fixture-0.1.0-darwin-arm64.tar.gz");
    writeFileSync(build(dir), `#!/bin/sh\necho "$(dirname "$0")/native-fixture-0.1.0-darwin-arm64.tar.gz"\n`);
    execFileSync("cp", [archive, join(dir, "native", "native-fixture-0.1.0-darwin-arm64.tar.gz")]);
    const out = join(again, "out");
    const r = spawnSync("python3", [packer, dir, "--out", out, "--repo", "acme/registry", "--skip-run"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(sha(readFileSync(join(out, "native-fixture-0.1.0.zip"))), first);
    rmSync(again, { recursive: true, force: true });
  } finally {
    p.cleanup();
  }
});

test("an archive without the declared executable is refused", () => {
  const p = pack((dir) => sedBuild(dir, "program=native-fixture/native-fixture", "program=native-fixture/renamed"));
  try {
    assert.notEqual(p.r.status, 0);
    assert.match(p.r.stderr, /has no native-fixture\/native-fixture/);
  } finally {
    p.cleanup();
  }
});

test("an executable without an execute bit is refused", () => {
  const p = pack((dir) => sedBuild(dir, "mode=755", "mode=644"));
  try {
    assert.notEqual(p.r.status, 0);
    assert.match(p.r.stderr, /has no execute bit/);
  } finally {
    p.cleanup();
  }
});

test("a mis-named archive is refused, so URLs stay predictable", () => {
  const p = pack((dir) => sedBuild(dir, "archive=native-fixture-0.1.0-darwin-arm64.tar.gz", "archive=something.tar.gz"));
  try {
    assert.notEqual(p.r.status, 0);
    assert.match(p.r.stderr, /must be native-fixture-0\.1\.0-darwin-arm64\.tar\.gz/);
  } finally {
    p.cleanup();
  }
});

test("a build script that fails fails the pack", () => {
  const p = pack((dir) => writeFileSync(build(dir), "#!/bin/sh\necho boom >&2\nexit 3\n"));
  try {
    assert.notEqual(p.r.status, 0);
    assert.match(p.r.stderr, /build-darwin-arm64\.sh exited 3/);
  } finally {
    p.cleanup();
  }
});

test("a build script that prints no path fails the pack", () => {
  const p = pack((dir) => writeFileSync(build(dir), "#!/bin/sh\nexit 0\n"));
  try {
    assert.notEqual(p.r.status, 0);
    assert.match(p.r.stderr, /printed no archive path/);
  } finally {
    p.cleanup();
  }
});
