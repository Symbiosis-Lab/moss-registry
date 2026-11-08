import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRequirement, nativeBuildMatrix } from "./registry-rules.mjs";

test("a named grant carries the binary it grants", () => {
  assert.deepEqual(classifyRequirement("execute_binary:git"), { kind: "named", binary: "git" });
});

test("the bare token is the deprecated blanket grant", () => {
  assert.deepEqual(classifyRequirement("execute_binary"), { kind: "blanket" });
});

test("a grant moss could never match is rejected, not silently accepted", () => {
  // moss matches against the basename of the call's binaryPath, so a grant
  // carrying a separator or an empty name grants nothing at runtime.
  for (const entry of ["execute_binary:", "execute_binary:/usr/bin/git", "execute_binary:a\\b"]) {
    assert.equal(classifyRequirement(entry).kind, "unknown", entry);
  }
});

test("an unrelated capability is unknown", () => {
  assert.equal(classifyRequirement("network").kind, "unknown");
});

const nativeManifest = (...platforms) => ({
  contributes: { derivations: { d: { run: { artifact: platforms.map((platform) => ({ kind: "download", platform })) } } } },
});

test("each platform a native plugin declares is built once, on its own runner", () => {
  const m = nativeManifest("linux-x64", "darwin-arm64", "linux-arm64", "linux-x64");
  assert.deepEqual(nativeBuildMatrix([{ dir: "plugins/ocr", manifest: m }]), [
    { plugin: "plugins/ocr", id: "ocr", platform: "darwin-arm64", runner: "macos-15" },
    { plugin: "plugins/ocr", id: "ocr", platform: "linux-arm64", runner: "ubuntu-22.04-arm" },
    { plugin: "plugins/ocr", id: "ocr", platform: "linux-x64", runner: "ubuntu-22.04" },
  ]);
});

test("a platform with no runner gets no build job, so the validator is what reports it", () => {
  assert.deepEqual(nativeBuildMatrix([{ dir: "plugins/ocr", manifest: nativeManifest("future-os") }]), []);
});
