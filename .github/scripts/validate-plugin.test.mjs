// Tests for the submission rules that are about surfaces rather than packaging
// (ADR-072). The validator is a script, so the unit under test is the script:
// build a plugin directory in a temp dir, run it, read what a reviewer sees.
//
//   node --test .github/scripts/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VALIDATOR = fileURLToPath(new URL("./validate-plugin.mjs", import.meta.url));

/** Write a minimal valid plugin, then run the validator over it. */
function validate({ manifest = {}, bundle = "" } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), "validate-plugin-")), "example");
  mkdirSync(join(dir, "assets"), { recursive: true });
  mkdirSync(join(dir, "dist"), { recursive: true });

  const full = {
    name: "example",
    version: "1.0.0",
    entry: "main.bundle.js",
    global_name: "ExamplePlugin",
    ...manifest,
  };
  writeFileSync(join(dir, "assets", "manifest.json"), JSON.stringify(full));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "example", version: full.version }));
  writeFileSync(join(dir, "package-lock.json"), "{}");
  writeFileSync(join(dir, "README.md"), "# example\n\n## Network access\n\nNone\n");
  writeFileSync(join(dir, "dist", full.entry), `var ExamplePlugin = {};\n${bundle}\n`);

  let stdout = "";
  try {
    stdout = execFileSync("node", [VALIDATOR, dir], { encoding: "utf8" });
  } catch (e) {
    stdout = e.stdout ?? "";
  }
  return stdout;
}

const deployTarget = (setup) => ({
  contributes: { deploy_target: { display_name: "Example", ...(setup ? { setup } : {}) } },
});

test("a plugin that draws its own password field is flagged", () => {
  const out = validate({ bundle: `var html = '<input type="password" name="token">';` });
  assert.match(out, /::warning::.*password field/);
  assert.match(out, /getSecret/);
});

test("a plugin that only reads a secret is not flagged", () => {
  const out = validate({ bundle: `await moss.getSecret("api_token");` });
  assert.doesNotMatch(out, /password field/);
});

test("declaring setup.check without the hook fails, rather than warning", () => {
  const out = validate({ manifest: deployTarget({ check: true }), bundle: "" });
  assert.match(out, /::error::.*check_setup/);
});

test("a check_setup hook nothing declared is flagged as dead code", () => {
  const out = validate({
    manifest: deployTarget({ credentials: [{ key: "token", label: "Token" }] }),
    bundle: `ExamplePlugin.check_setup = async () => ({ success: true });`,
  });
  assert.match(out, /::warning::.*never runs/);
});

test("declaring setup.check with the hook passes", () => {
  const out = validate({
    manifest: deployTarget({ check: true }),
    bundle: `ExamplePlugin.check_setup = async () => ({ success: true });`,
  });
  assert.doesNotMatch(out, /::error::/);
});
