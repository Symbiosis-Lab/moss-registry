/**
 * The github deploy plugin as moss runs it: `moss deploy` on a real site with
 * the plugin installed from dist/. Offline; GitHub is never contacted.
 *
 * Run: MOSS_BINARY=/path/to/moss INCLUDE_E2E=1 npx vitest run --project e2e
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const MOSS_BINARY = process.env.MOSS_BINARY;
// In CI a skipped suite would read as a pass, so a missing binary fails there.
if (!MOSS_BINARY && process.env.CI) throw new Error("MOSS_BINARY is not set; CI must run this suite");
if (!MOSS_BINARY) console.warn("github e2e skipped: set MOSS_BINARY to a moss CLI binary");

const PLUGIN_DIST = path.join(__dirname, "../dist");

let testDir: string;
let home: string;
let counter = 0;

type RepoState = "no-git" | "git-no-remote" | "gitlab-remote";

/** A real moss site that publishes through the github plugin. */
function createSite(repo: RepoState): string {
  const site = path.join(testDir, `site-${counter++}`);
  const pluginDir = path.join(site, ".moss", "plugins", "github");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(site, "index.md"), "# Hello\n\nA test site.\n");
  for (const file of fs.readdirSync(PLUGIN_DIST)) {
    fs.copyFileSync(path.join(PLUGIN_DIST, file), path.join(pluginDir, file));
  }
  // `environment` makes the folder "a site" to deploy; `[hooks] deploy` routes the publish to the plugin.
  fs.writeFileSync(
    path.join(site, ".moss", "config.toml"),
    'environment = "local"\n\n[hooks]\ndeploy = "github"\n',
  );
  if (repo !== "no-git") {
    execFileSync("git", ["init", "-q"], { cwd: site });
  }
  if (repo === "gitlab-remote") {
    execFileSync("git", ["remote", "add", "origin", "git@gitlab.com:user/repo.git"], { cwd: site });
  }
  return site;
}

function moss(args: string[]): Promise<{ output: string; code: number }> {
  return new Promise((resolve) => {
    // An empty HOME keeps the developer's own git credentials and moss
    // approvals out of the run, so "signed out" is the state under test.
    const proc = spawn(MOSS_BINARY!, args, {
      cwd: testDir,
      timeout: 90_000,
      env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: "1", CI: "true" },
    });
    let output = "";
    proc.stdout?.on("data", (d) => (output += d));
    proc.stderr?.on("data", (d) => (output += d));
    proc.on("close", (code) => resolve({ output, code: code ?? 1 }));
    proc.on("error", (err) => resolve({ output: output + err.message, code: 1 }));
  });
}

describe.skipIf(!MOSS_BINARY)("github plugin through moss deploy", () => {
  beforeAll(() => {
    if (!fs.existsSync(path.join(PLUGIN_DIST, "main.bundle.js"))) {
      throw new Error(`Plugin dist missing at ${PLUGIN_DIST}; run 'npm run build' first.`);
    }
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "moss-github-e2e-"));
    home = path.join(testDir, "home");
    fs.mkdirSync(home);
  });

  afterAll(() => {
    if (testDir) fs.rmSync(testDir, { recursive: true, force: true });
  });

  // The sign-in check runs before the plugin looks at git, so every repository
  // state stops at the same place and none reaches the network.
  it.each<RepoState>(["no-git", "git-no-remote", "gitlab-remote"])(
    "stops with the plugin's sign-in message when signed out (%s)",
    async (repo) => {
      const { output, code } = await moss(["deploy", createSite(repo), "--allow-plugins"]);

      expect(code).not.toBe(0);
      expect(output).toContain("Your GitHub sign-in has expired. Publish again to sign in.");
    },
  );
});
