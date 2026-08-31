import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRequirement } from "./registry-rules.mjs";

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
