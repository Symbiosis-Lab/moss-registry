#!/usr/bin/env node
// Validate a change to registry/revoked.json.
//
//   node .github/scripts/validate-revocations.mjs <base.json|--new> <head.json>
//
// revoked.json is the only way to reach a plugin already installed on someone's
// machine, and clients treat it fail-closed: an unparseable file, an unknown
// schema_version or a serial lower than the highest they have seen all mean
// "keep enforcing what I already know". That makes a malformed or
// serial-stalled commit worse than no commit — it silently freezes revocation
// for every client that has already seen a newer copy. So it is checked here,
// where a human can still fix it.
//
// Node builtins only.

import { readFileSync } from "node:fs";
import { ID_RE, SEMVER_RE } from "./registry-rules.mjs";

export const KNOWN_SCHEMA_VERSION = 1;

/**
 * Check the incoming file, and the serial's relationship to the outgoing one.
 * `base` is null when the file is being added for the first time.
 *
 * Pure — returns what is wrong rather than exiting, so it can be tested.
 */
export function validateRevocations(base, head) {
  const failures = [];
  const notes = [];
  const fail = (m) => failures.push(m);

  if (head === null || typeof head !== "object" || Array.isArray(head)) {
    return { failures: ["revoked.json must be a JSON object"], notes };
  }

  if (head.schema_version !== KNOWN_SCHEMA_VERSION) {
    fail(
      `schema_version is ${JSON.stringify(head.schema_version)}, expected ${KNOWN_SCHEMA_VERSION} — clients fail closed on a version they do not know, which freezes revocation for everyone already on a newer serial`,
    );
  }

  if (!Number.isInteger(head.serial) || head.serial < 1) {
    fail(`serial must be a positive integer, got ${JSON.stringify(head.serial)}`);
  }

  if (!Array.isArray(head.revocations)) {
    fail("revocations must be an array");
  } else {
    const seen = new Set();
    head.revocations.forEach((r, i) => {
      const at = `revocations[${i}]`;
      if (!r || typeof r !== "object") return fail(`${at} must be an object`);

      if (typeof r.id !== "string" || !ID_RE.test(r.id)) {
        fail(`${at}.id ${JSON.stringify(r.id)} is not a valid plugin id`);
      } else if (seen.has(r.id)) {
        fail(`${at}.id "${r.id}" appears twice — merge them into one entry so a client cannot apply half of it`);
      } else {
        seen.add(r.id);
      }

      if (r.versions !== "*" && !Array.isArray(r.versions)) {
        fail(`${at}.versions must be an array of versions, or "*" for every version`);
      } else if (Array.isArray(r.versions)) {
        if (r.versions.length === 0) {
          fail(`${at}.versions is empty — an entry that revokes nothing is almost certainly a mistake; use "*" to revoke everything`);
        }
        for (const v of r.versions) {
          if (typeof v !== "string" || !SEMVER_RE.test(v)) {
            fail(`${at}.versions contains ${JSON.stringify(v)}, which is not valid semver`);
          }
        }
      }

      // Shown to users verbatim, so an empty one is a broken dialog.
      if (typeof r.reason !== "string" || r.reason.trim() === "") {
        fail(`${at}.reason is required and is shown to users verbatim — write it for a writer, not an engineer`);
      }

      if (r.advisory_url !== undefined && typeof r.advisory_url !== "string") {
        fail(`${at}.advisory_url must be a string URL when present`);
      }
    });
  }

  if (base) {
    if (Number.isInteger(base.serial) && Number.isInteger(head.serial)) {
      if (head.serial <= base.serial) {
        fail(
          `serial must increase on every change: it is ${head.serial} and the base is ${base.serial}. Clients keep the highest serial they have seen and reject anything lower, so without a bump this edit reaches nobody.`,
        );
      }
    }

    const count = (f) => (Array.isArray(f?.revocations) ? f.revocations.length : 0);
    if (count(head) < count(base)) {
      notes.push(
        `this removes ${count(base) - count(head)} revocation(s) — un-revoking is legal but rarely intended; confirm the versions being released back are actually safe`,
      );
    }
  }

  return { failures, notes };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.log(`::error::${path}: not valid JSON — ${e.message}`);
    process.exit(1);
  }
}

if (import.meta.filename === process.argv[1]) {
  const [baseArg, headArg] = process.argv.slice(2);
  if (!headArg) {
    console.error("usage: validate-revocations.mjs <base.json|--new> <head.json>");
    process.exit(2);
  }
  const base = baseArg === "--new" ? null : readJson(baseArg);
  const head = readJson(headArg);

  const { failures, notes } = validateRevocations(base, head);
  for (const n of notes) console.log(`::warning::${n}`);
  if (failures.length === 0) {
    console.log(`revoked.json: OK (serial ${head.serial}, ${head.revocations.length} revocation(s))`);
    process.exit(0);
  }
  for (const f of failures) console.log(`::error::${f}`);
  console.error(`\nrevoked.json: ${failures.length} validation failure(s)`);
  process.exit(1);
}
