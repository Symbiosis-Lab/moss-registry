// Unit tests for the revocation-file guard.
//
//   node --test .github/scripts/

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateRevocations } from "./validate-revocations.mjs";

const ok = { schema_version: 1, serial: 2, revocations: [] };

const revocation = (over = {}) => ({
  id: "example",
  versions: ["1.1.0"],
  reason: "Exfiltrated vault contents via an undisclosed endpoint.",
  ...over,
});

const errs = (base, head) => validateRevocations(base, head).failures;
const only = (base, head) => {
  const f = errs(base, head);
  assert.equal(f.length, 1, `expected exactly one failure, got: ${JSON.stringify(f)}`);
  return f[0];
};

test("the file as committed today is valid", () => {
  assert.deepEqual(errs(null, { schema_version: 1, serial: 1, revocations: [] }), []);
});

test("a well-formed revocation passes", () => {
  const head = { ...ok, revocations: [revocation({ advisory_url: "https://example.invalid/a" })] };
  assert.deepEqual(errs({ ...ok, serial: 1 }, head), []);
});

// ------------------------------------------------------------------ serial --

test("an unchanged serial is rejected — the edit would reach nobody", () => {
  assert.match(only({ ...ok, serial: 7 }, { ...ok, serial: 7 }), /serial must increase/);
});

test("a lowered serial is rejected", () => {
  assert.match(only({ ...ok, serial: 7 }, { ...ok, serial: 6 }), /is 6 and the base is 7/);
});

test("a raised serial is accepted", () => {
  assert.deepEqual(errs({ ...ok, serial: 7 }, { ...ok, serial: 8 }), []);
});

test("serial must be a positive integer", () => {
  assert.match(only(null, { ...ok, serial: 0 }), /positive integer/);
  assert.match(only(null, { ...ok, serial: 1.5 }), /positive integer/);
  assert.match(only(null, { ...ok, serial: "3" }), /positive integer/);
});

test("a first-time add has no base to compare against", () => {
  assert.deepEqual(errs(null, { ...ok, serial: 1 }), []);
});

// ------------------------------------------------------------------ schema --

test("an unknown schema_version is rejected rather than deployed", () => {
  // Clients fail closed on it, which freezes revocation for anyone already
  // holding a newer serial — the failure mode is silent, so catch it here.
  assert.match(only(null, { ...ok, schema_version: 2 }), /clients fail closed/);
  assert.match(only(null, { ...ok, schema_version: undefined }), /schema_version/);
});

test("revocations must be an array", () => {
  assert.match(only(null, { ...ok, revocations: {} }), /must be an array/);
});

test("a non-object file is rejected outright", () => {
  assert.deepEqual(validateRevocations(null, []).failures, ["revoked.json must be a JSON object"]);
  assert.deepEqual(validateRevocations(null, null).failures, ["revoked.json must be a JSON object"]);
});

// ------------------------------------------------------------------ entries --

test("an invalid id is rejected", () => {
  assert.match(only(null, { ...ok, revocations: [revocation({ id: "Example" })] }), /not a valid plugin id/);
  assert.match(only(null, { ...ok, revocations: [revocation({ id: "" })] }), /not a valid plugin id/);
});

test("a duplicate id is rejected so a client cannot apply half of it", () => {
  const head = { ...ok, revocations: [revocation(), revocation({ versions: ["1.2.0"] })] };
  assert.match(only(null, head), /appears twice/);
});

test("versions accepts an explicit list or the wildcard", () => {
  assert.deepEqual(errs(null, { ...ok, revocations: [revocation({ versions: "*" })] }), []);
  assert.deepEqual(errs(null, { ...ok, revocations: [revocation({ versions: ["1.0.0", "1.1.0"] })] }), []);
});

test("an empty versions list is rejected as almost certainly a mistake", () => {
  assert.match(only(null, { ...ok, revocations: [revocation({ versions: [] })] }), /revokes nothing/);
});

test("a non-semver version is rejected", () => {
  assert.match(only(null, { ...ok, revocations: [revocation({ versions: ["1.1"] })] }), /not valid semver/);
  assert.match(only(null, { ...ok, revocations: [revocation({ versions: "all" })] }), /must be an array/);
});

test("reason is required because users are shown it verbatim", () => {
  assert.match(only(null, { ...ok, revocations: [revocation({ reason: "" })] }), /shown to users verbatim/);
  assert.match(only(null, { ...ok, revocations: [revocation({ reason: "   " })] }), /shown to users verbatim/);
  assert.match(only(null, { ...ok, revocations: [revocation({ reason: undefined })] }), /shown to users verbatim/);
});

test("advisory_url must be a string when present", () => {
  assert.match(only(null, { ...ok, revocations: [revocation({ advisory_url: 42 })] }), /must be a string URL/);
});

// ------------------------------------------------------------------- notes --

test("removing a revocation warns but does not fail", () => {
  const base = { ...ok, serial: 1, revocations: [revocation()] };
  const head = { ...ok, serial: 2, revocations: [] };
  const { failures, notes } = validateRevocations(base, head);
  assert.deepEqual(failures, []);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /un-revoking is legal but rarely intended/);
});

test("adding a revocation does not warn", () => {
  const base = { ...ok, serial: 1, revocations: [] };
  const head = { ...ok, serial: 2, revocations: [revocation()] };
  assert.deepEqual(validateRevocations(base, head).notes, []);
});
