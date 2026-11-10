#!/usr/bin/env node
// The catalog's date and signatures, around the `minisign` CLI that signs.
//
//   node .github/scripts/catalog-signing.mjs stamp <file> --days <n>
//   node .github/scripts/catalog-signing.mjs check <dir> --keys <dir>
//   node .github/scripts/catalog-signing.mjs check-url <base url> --keys <dir>
//
// `stamp` writes `expires` into index.json or revoked.json. moss stops
// offering installs from a catalog past its date, which is what stops an
// origin from freezing every app on an old catalog to hide a newer kill list;
// the weekly scheduled publish keeps the date ahead.
//
// `check` and `check-url` verify index.json and revoked.json against the
// `.minisig` beside each, with the public keys in `--keys` (one minisign .pub
// file each, the same keys moss pins). A missing or wrong signature fails, and
// so does an empty key folder, so a publish cannot deploy what the app would
// refuse, and losing registry/keys/ cannot turn the check off.
//
// Verification uses node:crypto alone (Ed25519 over a BLAKE2b-512 prehash,
// minisign's default), so the checks need no package and no `minisign` binary.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const DOCUMENTS = ["index.json", "revoked.json"];

/** `now` plus `days`, as RFC 3339 UTC to the second. */
export function expiresAt(now, days) {
  if (!Number.isInteger(days) || days < 1) throw new Error(`--days must be a positive integer, got ${days}`);
  return new Date(now.getTime() + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The document with `expires` set, placed after `serial` for people reading it. */
export function stampExpires(doc, expires) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === "expires") continue;
    out[k] = v;
    if (k === "serial") out.expires = expires;
  }
  if (!("expires" in out)) throw new Error("document has no serial");
  return out;
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** The base64 line of a minisign public key, from the whole .pub file or the line itself. */
function keyLine(text) {
  const lines = text.trim().split("\n").map((l) => l.trim());
  return lines.find((l) => !l.startsWith("untrusted comment:")) ?? "";
}

export function parseKey(text) {
  const raw = Buffer.from(keyLine(text), "base64");
  if (raw.length !== 42 || raw.subarray(0, 2).toString("latin1") !== "Ed") return null;
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw.subarray(10)]), format: "der", type: "spki" });
  // The id is stored little-endian; minisign prints it reversed, as here.
  return { id: Buffer.from(raw.subarray(2, 10)).reverse().toString("hex").toUpperCase(), key };
}

/**
 * Whether `bytes` carry a valid prehashed minisign signature by one of `keys`
 * (texts of .pub files). Returns null when it does, else the reason. Legacy
 * (non-prehashed) signatures are refused, as moss refuses them.
 */
export function signatureProblem(bytes, sigText, keys) {
  const lines = sigText.split("\n").map((l) => l.replace(/\r$/, ""));
  if (lines.length < 4 || !lines[2].startsWith("trusted comment: ")) return "not a minisign signature";
  const sig = Buffer.from(lines[1], "base64");
  const global = Buffer.from(lines[3], "base64");
  if (sig.length !== 74 || global.length !== 64) return "not a minisign signature";
  if (sig.subarray(0, 2).toString("latin1") !== "ED") return "not a prehashed signature";
  const id = Buffer.from(sig.subarray(2, 10)).reverse().toString("hex").toUpperCase();
  const pinned = keys.map(parseKey).find((k) => k && k.id === id);
  if (!pinned) return `signed by key ${id}, which is not pinned`;
  const prehash = createHash("blake2b512").update(bytes).digest();
  const detached = sig.subarray(10);
  if (!verify(null, prehash, pinned.key, detached)) return "signature does not match the bytes";
  const trusted = Buffer.from(lines[2].slice("trusted comment: ".length), "utf8");
  if (!verify(null, Buffer.concat([detached, trusted]), pinned.key, global)) return "trusted comment was altered";
  return null;
}

export function readKeys(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".pub"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));
}

/** Problems with each document and its signature, read through `read(name)` (bytes or null). */
export async function catalogProblems(read, keys) {
  if (keys.length === 0) return ["no public key to check against: registry/keys/ holds no .pub file"];
  const problems = [];
  for (const name of DOCUMENTS) {
    const bytes = await read(name);
    const sig = await read(`${name}.minisig`);
    if (bytes === null) problems.push(`${name}: missing`);
    else if (sig === null) problems.push(`${name}: no signature beside it`);
    else {
      const p = signatureProblem(bytes, sig.toString("utf8"), keys);
      if (p) problems.push(`${name}: ${p}`);
    }
  }
  return problems;
}

async function main(argv) {
  const [cmd, target] = argv;
  const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  if (cmd === "stamp") {
    const doc = JSON.parse(readFileSync(target, "utf8"));
    const stamped = stampExpires(doc, expiresAt(new Date(), Number(opt("--days"))));
    writeFileSync(target, JSON.stringify(stamped, null, 2) + "\n");
    console.log(`${target}: expires ${stamped.expires}`);
    return 0;
  }
  if (cmd === "check" || cmd === "check-url") {
    const keys = readKeys(opt("--keys") ?? "registry/keys");
    const read =
      cmd === "check"
        ? (name) => (existsSync(join(target, name)) ? readFileSync(join(target, name)) : null)
        : async (name) => {
            const res = await fetch(`${target}/${name}?t=${Date.now()}`);
            return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
          };
    const problems = await catalogProblems(read, keys);
    for (const p of problems) console.log(`::error::${p}`);
    if (!problems.length) console.log(`${DOCUMENTS.join(" and ")} verify against ${keys.length} pinned key(s)`);
    return problems.length ? 1 : 0;
  }
  console.error("usage: catalog-signing.mjs stamp <file> --days <n> | check <dir> --keys <dir> | check-url <url> --keys <dir>");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
