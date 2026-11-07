/**
 * The matters plugin as moss runs it: `moss build` on a real site with the
 * plugin installed from dist/. Offline and signed out; Matters is never contacted.
 *
 * Run: MOSS_BINARY=/path/to/moss npx vitest run --project e2e
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const MOSS_BINARY = process.env.MOSS_BINARY;
if (!MOSS_BINARY) console.warn("matters e2e skipped: set MOSS_BINARY to a moss CLI binary");

const PLUGIN_DIST = path.join(__dirname, "../dist");

let testDir: string;
let home: string;

/** A real moss site with the matters plugin installed. */
function createSite(): string {
  const site = path.join(testDir, "site");
  const pluginDir = path.join(site, ".moss", "plugins", "matters");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(site, "index.md"), "# My Blog\n\nWelcome!\n");
  for (const file of fs.readdirSync(PLUGIN_DIST)) {
    fs.copyFileSync(path.join(PLUGIN_DIST, file), path.join(pluginDir, file));
  }
  return site;
}

function moss(args: string[]): Promise<{ output: string; code: number }> {
  return new Promise((resolve) => {
    // An empty HOME keeps any real Matters session and moss approvals out of
    // the run, so "never signed in" is the state under test.
    const proc = spawn(MOSS_BINARY!, args, {
      cwd: testDir,
      timeout: 90_000,
      env: { ...process.env, HOME: home, MOSS_LOG_LEVEL: "debug", CI: "true" },
    });
    let output = "";
    proc.stdout?.on("data", (d) => (output += d));
    proc.stderr?.on("data", (d) => (output += d));
    proc.on("close", (code) => resolve({ output, code: code ?? 1 }));
    proc.on("error", (err) => resolve({ output: output + err.message, code: 1 }));
  });
}

describe.skipIf(!MOSS_BINARY)("matters plugin through moss build", () => {
  beforeAll(() => {
    if (!fs.existsSync(path.join(PLUGIN_DIST, "main.bundle.js"))) {
      throw new Error(`Plugin dist missing at ${PLUGIN_DIST}; run 'npm run build' first.`);
    }
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "moss-matters-e2e-"));
    home = path.join(testDir, "home");
    fs.mkdirSync(home);
  });

  afterAll(() => {
    if (testDir) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("a signed-out build completes and the import step skips quietly", async () => {
    const site = createSite();
    const { output, code } = await moss(["build", site, "--allow-plugins"]);

    expect(code).toBe(0);
    expect(fs.existsSync(path.join(site, ".moss", "build.nosync", "current", "index.html"))).toBe(true);
    // The plugin's own log: no account is bound and nobody is present to sign in.
    expect(output).toContain("Not bound and no user present; skipping sync quietly");
  });
});
