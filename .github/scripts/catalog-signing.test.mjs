import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expiresAt, stampExpires, signatureProblem, catalogProblems, parseKey } from "./catalog-signing.mjs";

// Test keys only, made with Ubuntu's `minisign -G -W` (the package the signing
// job installs); key A signed every document here, key B only the `.b.minisig`.
const dir = join(import.meta.dirname, "fixtures", "catalog-signing");
const read = (name) => readFileSync(join(dir, name));
const KEY_A = read("a.pub").toString();
const KEY_B = read("b.pub").toString();
const INDEX = read("index-28.json");
const SIG_A = read("index-28.json.minisig").toString();
const SIG_B = read("index-28.json.b.minisig").toString();

test("expiresAt is whole days ahead, to the second, in UTC", () => {
  assert.equal(expiresAt(new Date("2026-11-02T10:20:30.456Z"), 21), "2026-11-23T10:20:30Z");
  assert.throws(() => expiresAt(new Date(), 0), /positive integer/);
});

test("stampExpires sets expires after serial and replaces an old one", () => {
  const doc = { schema_version: 1, serial: 7, expires: "old", revocations: [] };
  const out = stampExpires(doc, "2026-11-23T00:00:00Z");
  assert.deepEqual(Object.keys(out), ["schema_version", "serial", "expires", "revocations"]);
  assert.equal(out.expires, "2026-11-23T00:00:00Z");
  assert.throws(() => stampExpires({ entries: [] }, "x"), /no serial/);
});

test("a document signed by the minisign CLI verifies against its key", () => {
  assert.equal(signatureProblem(INDEX, SIG_A, [KEY_A]), null);
  assert.equal(signatureProblem(INDEX, SIG_B, [KEY_A, KEY_B]), null);
});

test("a signature by a key that is not pinned is refused", () => {
  assert.match(signatureProblem(INDEX, SIG_B, [KEY_A]), /not pinned/);
});

test("one changed byte is refused", () => {
  const tampered = Buffer.from(INDEX.toString().replace('"serial":28', '"serial":99'));
  assert.match(signatureProblem(tampered, SIG_A, [KEY_A]), /does not match/);
});

test("an altered trusted comment is refused", () => {
  const altered = SIG_A.replace("trusted comment: moss-registry test fixture", "trusted comment: something else");
  assert.match(signatureProblem(INDEX, altered, [KEY_A]), /trusted comment/);
});

test("a legacy signature by a pinned key is refused", () => {
  // `minisign -l`: signs the bytes themselves instead of their hash.
  assert.match(signatureProblem(INDEX, read("index-28.json.legacy.minisig").toString(), [KEY_A]), /not a prehashed/);
});

test("something that is not a signature is refused", () => {
  assert.match(signatureProblem(INDEX, "<!doctype html>", [KEY_A]), /not a minisign signature/);
});

test("with no key pinned the catalog is refused", async () => {
  assert.equal((await catalogProblems(() => null, [])).length, 1);
});

test("with a key pinned, every document must carry a valid signature", async () => {
  const files = {
    "index.json": INDEX,
    "index.json.minisig": Buffer.from(SIG_A),
    "revoked.json": read("revoked-7.json"),
    "revoked.json.minisig": read("revoked-7.json.minisig"),
  };
  assert.deepEqual(await catalogProblems((n) => files[n] ?? null, [KEY_A]), []);
  delete files["revoked.json.minisig"];
  assert.deepEqual(await catalogProblems((n) => files[n] ?? null, [KEY_A]), ["revoked.json: no signature beside it"]);
});

test("registry/keys holds the signing and backup keys, each named by its id", () => {
  const keysDir = join(import.meta.dirname, "..", "..", "registry", "keys");
  const files = readdirSync(keysDir).filter((f) => f.endsWith(".pub")).sort();
  assert.deepEqual(files, ["4366D851417F5FA9.pub", "DD6C6009CFC9114C.pub"]);
  for (const f of files) assert.equal(parseKey(readFileSync(join(keysDir, f), "utf8")).id, f.replace(".pub", ""));
});
