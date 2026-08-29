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

// --- the setup block's own schema -------------------------------------------
// A typo here is silent at runtime: moss reads the block with no plugin code
// running, finds nothing where the author meant a credential, and publishes
// into the failure the block existed to prevent.

const withHook = `ExamplePlugin.check_setup = async () => ({ success: true });`;
const cred = (over = {}) => ({ key: "api_token", label: "API token", ...over });

test("a well-formed setup block passes", () => {
  const out = validate({
    manifest: deployTarget({
      check: true,
      credentials: [cred({ help_url: "https://example.com/keys", when: { provider: "hosted" } })],
    }),
    bundle: withHook,
  });
  assert.doesNotMatch(out, /::error::/);
});

test("a misspelled setup key fails instead of being ignored", () => {
  const out = validate({ manifest: deployTarget({ credential: [cred()] }) });
  assert.match(out, /::error::.*unknown key in contributes\.deploy_target\.setup: "credential"/);
});

test("a misspelled deploy_target fails — the block below it would never be read", () => {
  const out = validate({
    manifest: { contributes: { "deploy-target": { setup: { credentials: [cred()] } } } },
  });
  assert.match(out, /::error::.*unknown key in contributes: "deploy-target"/);
});

test("a misspelled key inside deploy_target fails", () => {
  const out = validate({ manifest: { contributes: { deploy_target: { setups: {} } } } });
  assert.match(out, /::error::.*unknown key in contributes\.deploy_target: "setups"/);
});

test("a misspelled channel flag fails, since serde would ignore it", () => {
  const out = validate({ manifest: { contributes: { channel: { requires_auth: true } } } });
  assert.match(out, /::error::.*unknown key in contributes\.channel: "requires_auth"/);
});

test("a credential with no label fails, because moss's modal has nothing to call it", () => {
  const out = validate({ manifest: deployTarget({ credentials: [{ key: "api_token" }] }) });
  assert.match(out, /::error::.*label is required/);
});

test("a credential key the host's store would refuse fails", () => {
  const out = validate({ manifest: deployTarget({ credentials: [cred({ key: "../escape" })] }) });
  assert.match(out, /::error::.*may not contain/);
});

test("a credential carrying a default value fails — a shipped secret is not a secret", () => {
  const out = validate({ manifest: deployTarget({ credentials: [cred({ default: "sk-live-…" })] }) });
  assert.match(out, /::error::.*"default"/);
});

test("a non-string when value fails, since moss compares rendered values", () => {
  const out = validate({ manifest: deployTarget({ credentials: [cred({ when: { paid: true } })] }) });
  assert.match(out, /::error::.*when\.paid must be a STRING/);
});

test("one key declared twice fails", () => {
  const out = validate({ manifest: deployTarget({ credentials: [cred(), cred()] }) });
  assert.match(out, /::error::.*declared twice/);
});

test("check must be a boolean, not the string \"true\"", () => {
  const out = validate({ manifest: deployTarget({ check: "true" }), bundle: withHook });
  assert.match(out, /::error::.*setup\.check must be true or false/);
});

test("credentials must be a list, not one object", () => {
  const out = validate({ manifest: deployTarget({ credentials: cred() }) });
  assert.match(out, /::error::.*must be a list/);
});

test("a progress heartbeat on a timer is flagged", () => {
  const out = validate({
    bundle: `setInterval(function () { reportProgress("upload", 1, 10, "working"); }, 10000);`,
  });
  assert.match(out, /::warning::.*progress on a timer/);
});

test("a panel that waits for an answer is flagged", () => {
  const out = validate({
    bundle: `await openBrowserWithHtml(html); await onEvent("plugin:answer", cb);`,
  });
  assert.match(out, /::warning::.*asking the user a question/);
});
