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
  ...over,
});

const run = (entries, { liveSerial = 5, wantSerial = null, files = {} } = {}) => {
  index = { schema_version: 1, serial: liveSerial, entries };
  served = { "/essays.zip": SRC, "/essays-preview.zip": PRE, ...files };
  return verifyPublished({ indexUrl: `${base}/index.json`, serial: wantSerial, attempts: 2, delayMs: 1 });
};

test("good bytes pass, both zips checked", async () => {
  const r = await run([starter()]);
  assert.deepEqual(r.failures, []);
  assert.equal(r.checked, 2);
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
  assert.equal(r.checked, 2);
});

test("a starter without preview fields is reported, not a crash", async () => {
  const bare = starter();
  delete bare.preview_url;
  delete bare.preview_sha256;
  delete bare.preview_size_bytes;
  const r = await run([bare]);
  assert.equal(r.checked, 1);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /preview: index entry has no url, sha256, size/);
});

test("serial lag is a warning, not a failure", async () => {
  const r = await run([starter()], { liveSerial: 4, wantSerial: 5 });
  assert.deepEqual(r.failures, []);
  assert.match(r.warnings[0], /live serial is 4, expected 5/);
});
