// Tests for the post-publish check, against a local http server that serves
// good and corrupted bytes.
//
//   node --test .github/scripts/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

import { verifyPublished } from "./verify-published.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const SRC = Buffer.from("source zip bytes");
const PRE = Buffer.from("preview zip bytes, a little longer");
const POSTER_L = Buffer.from("light poster jpeg");
const POSTER_D = Buffer.from("dark poster jpeg, different");

let server;
let base;
let index;
let served; // path -> Buffer | status code

before(async () => {
  server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/index.json") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(index));
    }
    const v = served[path];
    if (typeof v === "number") {
      res.statusCode = v;
      return res.end();
    }
    res.end(v);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const starter = (over = {}) => ({
  type: "starter",
  id: "essays",
  version: "1.0.0",
  download_url: `${base}/essays.zip`,
  sha256: sha(SRC),
  size_bytes: SRC.length,
  preview_url: `${base}/essays-preview.zip`,
  preview_sha256: sha(PRE),
  preview_size_bytes: PRE.length,
  poster_light_url: `${base}/essays-poster-light.jpg`,
  poster_light_sha256: sha(POSTER_L),
  poster_light_size_bytes: POSTER_L.length,
  poster_dark_url: `${base}/essays-poster-dark.jpg`,
  poster_dark_sha256: sha(POSTER_D),
  poster_dark_size_bytes: POSTER_D.length,
  ...over,
});

const run = (entries, { liveSerial = 5, wantSerial = null, files = {}, readManifest } = {}) => {
  index = { schema_version: 1, serial: liveSerial, entries };
  served = { "/essays.zip": SRC, "/essays-preview.zip": PRE, "/essays-poster-light.jpg": POSTER_L, "/essays-poster-dark.jpg": POSTER_D, ...files };
  return verifyPublished({ indexUrl: `${base}/index.json`, serial: wantSerial, attempts: 2, delayMs: 1, ...(readManifest && { readManifest }) });
};

test("good bytes pass, both zips and both posters checked", async () => {
  const r = await run([starter()]);
  assert.deepEqual(r.failures, []);
  assert.equal(r.checked, 4);
});

test("wrong sha fails", async () => {
  const r = await run([starter({ sha256: sha("other") })]);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /essays@1\.0\.0 source: sha256/);
});

test("wrong size fails", async () => {
  const r = await run([starter({ preview_size_bytes: PRE.length + 1 })]);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /preview: size/);
});

test("a 404 fails", async () => {
  const r = await run([starter()], { files: { "/essays-preview.zip": 404 } });
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /preview: HTTP 404/);
});

test("plugin entries are ignored", async () => {
  const plugin = { type: "plugin", id: "p", version: "1.0.0", download_url: `${base}/gone.zip`, sha256: "00", size_bytes: 1 };
  const r = await run([plugin, starter()]);
  assert.deepEqual(r.failures, []);
  assert.equal(r.checked, 4);
});

test("a corrupted poster fails, whichever one", async () => {
  const bad = await run([starter()], { files: { "/essays-poster-dark.jpg": Buffer.from("truncated") } });
  assert.equal(bad.failures.length, 2); // size and sha both disagree
  assert.match(bad.failures[0], /poster dark: size/);
  const gone = await run([starter()], { files: { "/essays-poster-light.jpg": 404 } });
  assert.equal(gone.failures.length, 1);
  assert.match(gone.failures[0], /poster light: HTTP 404/);
});

test("an entry naming a poster half-way is reported; one naming none is not", async () => {
  const half = starter();
  delete half.poster_dark_sha256;
  const r = await run([half]);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /poster dark: index entry has no sha256/);
  const old = starter();
  for (const k of Object.keys(old)) if (k.startsWith("poster_")) delete old[k];
  const r2 = await run([old]);
  assert.deepEqual(r2.failures, []);
  assert.equal(r2.checked, 2);
});

test("a starter without preview fields is reported, not a crash", async () => {
  const bare = starter();
  delete bare.preview_url;
  delete bare.preview_sha256;
  delete bare.preview_size_bytes;
  const r = await run([bare]);
  assert.equal(r.checked, 3);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /preview: index entry has no url, sha256, size/);
});

test("serial lag is a warning, not a failure", async () => {
  const r = await run([starter()], { liveSerial: 4, wantSerial: 5 });
  assert.deepEqual(r.failures, []);
  assert.match(r.warnings[0], /live serial is 4, expected 5/);
});

// ----------------------------------------------- program-only plugins --

const PROG = Buffer.from("the program's archive bytes");
const PLUGIN_ZIP = Buffer.from("plugin zip bytes");
const program = (over = {}) => ({
  type: "plugin",
  id: "prog",
  version: "1.0.0",
  platforms: ["darwin-arm64"],
  download_url: `${base}/prog.zip`,
  sha256: sha(PLUGIN_ZIP),
  size_bytes: PLUGIN_ZIP.length,
  ...over,
});
const manifestPinning = (digest) => () => ({
  contributes: { derivations: { d: { run: { artifact: [{ kind: "download", platform: "darwin-arm64", url: `${base}/prog.tar.gz`, sha256: digest }] } } } },
});
const withProgram = { "/prog.zip": PLUGIN_ZIP, "/prog.tar.gz": PROG };

test("a program-only plugin passes when its zip and its program match", async () => {
  const r = await run([program()], { files: withProgram, readManifest: manifestPinning(sha(PROG)) });
  assert.deepEqual(r.failures, []);
  assert.equal(r.checked, 2);
});

test("a program whose bytes changed after indexing fails", async () => {
  const r = await run([program()], { files: { ...withProgram, "/prog.tar.gz": Buffer.from("swapped") }, readManifest: manifestPinning(sha(PROG)) });
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /prog@1\.0\.0 program d\/darwin-arm64: sha256/);
});

test("a deleted program fails with its status", async () => {
  const r = await run([program()], { files: { ...withProgram, "/prog.tar.gz": 404 }, readManifest: manifestPinning(sha(PROG)) });
  assert.match(r.failures[0], /HTTP 404/);
});

test("platforms in the index must agree with the manifest in the zip", async () => {
  const r = await run([program({ platforms: ["linux-x64"] })], { files: withProgram, readManifest: manifestPinning(sha(PROG)) });
  assert.match(r.failures.join("\n"), /index platforms .*linux-x64.* differ/);
});

test("a plugin without platforms is not downloaded at all", async () => {
  const r = await run([program({ platforms: undefined })], { files: {}, readManifest: () => assert.fail("no manifest read") });
  assert.deepEqual(r.failures, []);
  assert.equal(r.checked, 0);
});

test("revoked.json must be JSON with a serial", async () => {
  const { verifyRevoked } = await import("./verify-published.mjs");
  const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });
  assert.deepEqual(await verifyRevoked({ revokedUrl: "u", fetchImpl: reply(200, { serial: 1, revoked: [] }) }), []);
  assert.equal((await verifyRevoked({ revokedUrl: "u", fetchImpl: reply(404) })).length, 1);
  assert.equal((await verifyRevoked({ revokedUrl: "u", fetchImpl: reply(200, { revoked: [] }) })).length, 1);
});
