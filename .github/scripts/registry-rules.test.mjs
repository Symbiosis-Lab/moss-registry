import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRequirement, nativeBuildMatrix, networkProblems, pluginKind } from "./registry-rules.mjs";

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

test("the shape of a manifest decides its kind", () => {
  assert.equal(pluginKind({ entry: "main.js" }), "js");
  assert.equal(pluginKind({ entry: "main.js", contributes: { derivations: { a: {} } } }), "js");
  assert.equal(pluginKind({ entry: "" }), "js");
  assert.equal(pluginKind({ contributes: { derivations: { a: {} } } }), "native");
  assert.equal(pluginKind({ contributes: { blocks: {} } }), "declared");
  assert.equal(pluginKind({ contributes: { derivations: {} } }), "declared");
  assert.equal(pluginKind({}), "declared");
});

const hostsProblems = (hosts, readme = hosts.join(" ")) => networkProblems({ network: { hosts } }, readme);

test("a host entry may name its port", () => {
  assert.deepEqual(hostsProblems(["api.example.com:8443", "*.example.com:443", "127.0.0.1:5001", "localhost:5001", "[::1]:5001"]), []);
});

test("a port moss could never match, a scheme or a path is refused", () => {
  for (const entry of ["api.example.com:0", "api.example.com:65536", "api.example.com:05001", "api.example.com:", "https://api.example.com", "api.example.com/v1", "[::1]", "::1", "[nothost]:80"]) {
    assert.equal(hostsProblems([entry]).length, 1, entry);
  }
});

test("a loopback entry without a port is refused, since it reaches every local service", () => {
  for (const entry of ["localhost", "app.localhost", "*.localhost", "127.0.0.1", "127.5.6.7", "0.0.0.0"]) {
    assert.match(hostsProblems([entry]).join(), /loopback/, entry);
  }
});

test("a portless loopback entry stays beside the same host with a port, for moss that compares whole entries", () => {
  assert.deepEqual(hostsProblems(["127.0.0.1", "127.0.0.1:5001", "*.localhost", "*.localhost:8080"]), []);
  assert.match(hostsProblems(["127.0.0.1", "localhost:5001"]).join(), /loopback/);
});

test("a portless public host is still any port", () => {
  assert.deepEqual(hostsProblems(["api.example.com", "*.example.com", "127.0.0.1.nip.io"]), []);
});

test("the README names a ported host without its port", () => {
  assert.deepEqual(hostsProblems(["127.0.0.1:5001", "[::1]:5001"], "the local node at 127.0.0.1 and ::1"), []);
  assert.match(hostsProblems(["api.example.com:8443"], "nothing here").join(), /does not mention api\.example\.com/);
});
