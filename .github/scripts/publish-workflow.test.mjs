// publish.yml's shell steps, run as written with `gh` and friends stubbed.
// The sign job deliberately runs no code from this repository, so the steps
// stay inline in the workflow and are tested by reading them out of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const yml = readFileSync(join(import.meta.dirname, "..", "workflows", "publish.yml"), "utf8").split("\n");

/** The lines of a job or step: everything indented deeper than its header. */
function block(lines, start, indent) {
  let end = start + 1;
  while (end < lines.length && (lines[end] === "" || lines[end].search(/\S/) > indent)) end++;
  return lines.slice(start + 1, end);
}

function job(name) {
  const start = yml.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `no job ${name}`);
  return block(yml, start, 2);
}

function step(jobName, name) {
  const lines = job(jobName);
  const start = lines.indexOf(`      - name: ${name}`);
  assert.notEqual(start, -1, `no step ${name}`);
  return block(lines, start, 6);
}

/** A step's `run: |` script, with the YAML indent removed. */
function script(jobName, name) {
  const lines = step(jobName, name);
  const start = lines.indexOf("        run: |");
  assert.notEqual(start, -1, `${name} has no run block`);
  return block(lines, start, 8).map((l) => l.slice(10)).join("\n");
}

/** Runs `body` as Actions would, with the named commands stubbed on PATH. */
function runStep(body, stubs, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "publish-workflow-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    for (const [name, text] of Object.entries(stubs)) {
      writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "$CALLS"\n${text}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    mkdirSync(join(dir, "public"));
    for (const f of ["index.json", "revoked.json"]) writeFileSync(join(dir, "public", f), "{}\n");
    const calls = join(dir, "calls");
    writeFileSync(calls, "");
    const out = spawnSync("bash", ["-e", "-c", body], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: calls, ...env },
    });
    return {
      status: out.status,
      stdout: out.stdout + out.stderr,
      calls: readFileSync(calls, "utf8").split("\n").filter(Boolean),
      signed: ["index.json.minisig", "revoked.json.minisig"].filter((f) => existsSync(join(dir, "public", f))),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SIGN = "Sign index.json and revoked.json";
const signStubs = {
  sudo: "exit 0",
  minisign: 'while [ $# -gt 0 ]; do [ "$1" = -m ] && touch "$2.minisig"; shift; done',
};

test("an empty signing key stops the sign step before anything is signed", () => {
  const r = runStep(script("sign", SIGN), signStubs, { SIGNING_KEY: "", SERIAL: "7" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error::MOSS_REGISTRY_SIGNING_KEY/);
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.signed, []);
});

test("with a signing key both documents are signed", () => {
  const r = runStep(script("sign", SIGN), signStubs, { SIGNING_KEY: "not a real key", SERIAL: "7" });
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.signed, ["index.json.minisig", "revoked.json.minisig"]);
});

test("the deploy job runs only after a successful sign, and checks signatures before Pages", () => {
  const lines = job("deploy");
  assert.ok(lines.includes("    needs: sign"));
  assert.ok(lines.includes("    if: always() && needs.sign.result == 'success'"));
  const check = lines.indexOf("      - name: Check the signatures against the pinned keys");
  const pages = lines.indexOf("        uses: actions/deploy-pages@v4");
  assert.ok(check !== -1 && pages !== -1 && check < pages);
});

const PRUNE = "Delete index releases past the newest five";
const TAGS = ["index-60", "index-59-2", "index-59", "index-58", "index-57", "index-56", "index-55", "pdf-ocr-v1.0.0", "index-v1.0.0"];
const list = `if [ "$2" = list ]; then printf '%s\\n' ${TAGS.join(" ")}; exit 0; fi`;
const pruneEnv = { GH_TOKEN: "t", GITHUB_REPOSITORY: "acme/registry" };

test("pruning deletes only old index releases and never asks to delete a tag", () => {
  const r = runStep(script("deploy", PRUNE), { gh: `${list}\n[[ "$*" != *--cleanup-tag* ]] || { echo "HTTP 422: Cannot delete this tag" >&2; exit 1; }` }, pruneEnv);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.calls.filter((c) => c.startsWith("gh release delete")).map((c) => c.split(" ")[3]), ["index-56", "index-55"]);
  assert.doesNotMatch(r.stdout, /::warning::/);
});

test("a release that cannot be deleted is warned about, and the rest are still tried", () => {
  const r = runStep(script("deploy", PRUNE), { gh: `${list}\necho "HTTP 422: Repository rule violations found" >&2; exit 1` }, pruneEnv);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.calls.filter((c) => c.startsWith("gh release delete")).length, 2);
  assert.match(r.stdout, /::warning::could not delete release index-56/);
});

test("pruning cannot fail the job, so verify always runs after a deploy", () => {
  assert.ok(step("deploy", PRUNE).includes("        continue-on-error: true"));
  assert.doesNotMatch(script("deploy", "Publish the same files as the Latest release"), /release delete/);
  const verify = job("verify");
  assert.ok(verify.includes("    needs: deploy"));
  assert.ok(verify.includes("    if: always() && needs.deploy.result == 'success'"));
});
