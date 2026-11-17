// The pre-push hook runs the registry's checks on the plugins a push touches, and only those.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// A clone of this checkout with a commit on top, pushed by the hook as a new branch.
function pushOf(change) {
  const clone = mkdtempSync(join(tmpdir(), "pre-push-"));
  execFileSync("git", ["clone", "-q", "--local", "--no-hardlinks", repo, clone]);
  git(clone, "update-ref", "refs/remotes/origin/main", "HEAD");
  mkdirSync(join(clone, ".githooks"), { recursive: true });
  for (const f of ["scripts/check-plugin", ".githooks/pre-push"]) writeFileSync(join(clone, f), readFileSync(join(repo, f)), { mode: 0o755 });
  change(clone);
  git(clone, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qam", "change");
  const sha = git(clone, "rev-parse", "HEAD");
  return spawnSync("bash", [join(clone, ".githooks/pre-push"), "origin", "x"], {
    cwd: clone, encoding: "utf8", input: `refs/heads/b ${sha} refs/heads/b ${"0".repeat(40)}\n`,
  });
}

const manifest = (clone) => join(clone, "plugins/pdf-ocr/assets/manifest.json");

test("a push that breaks a plugin's manifest is refused with the validator's reason", () => {
  const r = pushOf((clone) => {
    const m = JSON.parse(readFileSync(manifest(clone), "utf8"));
    m.version = "not-a-version";
    writeFileSync(manifest(clone), JSON.stringify(m, null, 2));
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /pre-push: checking plugins\/pdf-ocr/);
  assert.match(r.stdout + r.stderr, /manifest.version "not-a-version" is not valid semver/);
  assert.match(r.stdout + r.stderr, /pre-push: plugins\/pdf-ocr fails the registry's checks/);
});

test("a push that deletes a plugin's manifest is refused", () => {
  const r = pushOf((clone) => git(clone, "rm", "-q", "plugins/pdf-ocr/assets/manifest.json"));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /pre-push: plugins\/pdf-ocr fails the registry's checks/);
});

test("a push that touches no plugin checks nothing", () => {
  const r = pushOf((clone) => writeFileSync(join(clone, "README.md"), "changed\n"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /checking/);
});
