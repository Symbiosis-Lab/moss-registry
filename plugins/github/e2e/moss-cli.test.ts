/**
 * E2E Tests for GitHub Deployer Plugin using moss CLI
 *
 * These tests verify the plugin works correctly when invoked through
 * the moss CLI, testing real-world scenarios.
 *
 * Requirements:
 * - moss binary built and available (set MOSS_BINARY env var or build locally)
 * - Plugin built (npm run build)
 * - Tests create temporary directories for fixtures
 * - Display server available (xvfb-run on Linux CI)
 *
 * Plugin Execution:
 * - Use --wait-plugins flag to wait for plugin hooks to complete
 * - Plugin JavaScript runs in Tauri webview (requires display)
 * - Tests verify plugin validation messages and error handling
 *
 * CI Setup:
 * - The workflow downloads moss binary from releases before running tests
 * - Set MOSS_BINARY environment variable to the binary path
 * - Linux CI uses xvfb-run for display server
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync, spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Path to moss binary - check env var first, then fallback to local dev path
const MOSS_BINARY = process.env.MOSS_BINARY || path.join(
  __dirname,
  "../../../../moss/develop/src-tauri/target/debug/moss"
);

// Check if we're using a release binary (from CI) vs local dev build
const IS_CI_BINARY = !!process.env.MOSS_BINARY;

// Check if --wait-plugins is supported (v0.3.1+)
let HAS_WAIT_PLUGINS = false;

// Path to plugin dist
const PLUGIN_DIST = path.join(__dirname, "../dist");

// Test fixture directory
let testDir: string;
let fixtureCounter = 0;

/**
 * Create a test fixture directory with optional git initialization
 */
function createFixture(options: {
  withGit?: boolean;
  withRemote?: string;
  withPlugin?: boolean;
  content?: Record<string, string>;
}): string {
  const fixtureName = `moss-e2e-${Date.now()}-${fixtureCounter++}`;
  const fixturePath = path.join(testDir, fixtureName);
  fs.mkdirSync(fixturePath, { recursive: true });

  // Create content files
  const defaultContent = {
    "index.md": "# Hello World\n\nThis is a test site.",
    "about.md": "# About\n\nAbout page content.",
  };

  const content = options.content || defaultContent;
  for (const [filename, fileContent] of Object.entries(content)) {
    const filePath = path.join(fixturePath, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, fileContent);
  }

  // Initialize git if requested
  if (options.withGit) {
    execSync("git init", { cwd: fixturePath, stdio: "pipe" });
    execSync("git config user.email 'test@example.com'", {
      cwd: fixturePath,
      stdio: "pipe",
    });
    execSync("git config user.name 'Test User'", {
      cwd: fixturePath,
      stdio: "pipe",
    });
    execSync("git add .", { cwd: fixturePath, stdio: "pipe" });
    execSync('git commit -m "Initial commit"', {
      cwd: fixturePath,
      stdio: "pipe",
    });

    // Add remote if requested
    if (options.withRemote) {
      execSync(`git remote add origin ${options.withRemote}`, {
        cwd: fixturePath,
        stdio: "pipe",
      });
    }
  }

  // Link plugin if requested
  if (options.withPlugin) {
    const mossDir = path.join(fixturePath, ".moss");
    const pluginsDir = path.join(mossDir, "plugins");
    const githubPluginDir = path.join(pluginsDir, "github");

    fs.mkdirSync(pluginsDir, { recursive: true });

    // Copy plugin files (symlink might not work on all systems)
    const pluginFiles = ["main.bundle.js", "manifest.json", "icon.svg"];
    fs.mkdirSync(githubPluginDir, { recursive: true });

    for (const file of pluginFiles) {
      const src = path.join(PLUGIN_DIST, file);
      const dest = path.join(githubPluginDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }
  }

  return fixturePath;
}

/**
 * Run moss CLI and return stdout/stderr
 */
function runMoss(
  args: string[],
  options?: { cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(MOSS_BINARY, args, {
      cwd: options?.cwd || testDir,
      timeout: options?.timeout || 30000,
      env: {
        ...process.env,
        // Disable interactive prompts
        CI: "true",
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    proc.on("error", (err) => {
      stderr += err.message;
      resolve({ stdout, stderr, code: 1 });
    });
  });
}

describe("moss CLI E2E Tests", () => {
  beforeAll(async () => {
    // Verify moss binary exists - fail if not available
    if (!fs.existsSync(MOSS_BINARY)) {
      throw new Error(
        `moss binary not found at ${MOSS_BINARY}. ` +
        `Either build moss locally, or set MOSS_BINARY environment variable. ` +
        `In CI, the binary should be downloaded from releases.`
      );
    }

    // Verify plugin dist exists - fail if not built
    if (!fs.existsSync(PLUGIN_DIST)) {
      throw new Error(
        `Plugin dist not found at ${PLUGIN_DIST}. Please build the plugin first with 'npm run build'.`
      );
    }

    // Create temp directory for test fixtures
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "moss-e2e-"));

    // Check if --wait-plugins is supported
    const { stdout } = await runMoss(["--help"]);
    HAS_WAIT_PLUGINS = stdout.includes("--wait-plugins");
  });

  afterAll(() => {
    // Cleanup test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("moss --help", () => {
    it("shows help message with build command", async () => {
      const { stdout, code } = await runMoss(["--help"]);

      expect(code).toBe(0);
      expect(stdout).toContain("moss");
      expect(stdout).toContain("build");
    });

    it("shows help message with deploy command", async () => {
      const { stdout, code } = await runMoss(["--help"]);

      expect(code).toBe(0);
      expect(stdout).toContain("deploy");
      expect(stdout).toContain("GitHub Pages");
    });
  });

  describe("Basic compilation (no plugins)", () => {
    it("builds a folder with markdown files", async () => {
      const fixture = createFixture({ content: { "index.md": "# Hello" } });

      const { stdout, stderr, code } = await runMoss([
        "build",
        fixture,
        "--no-plugins",
      ]);

      // Should succeed
      expect(code).toBe(0);
      expect(stdout + stderr).toContain("Compiling");

      // Should create .moss/site directory
      const siteDir = path.join(fixture, ".moss", "site");
      expect(fs.existsSync(siteDir)).toBe(true);
    });
  });

  describe("Deploy command", () => {
    // This test verifies exit code 1 when no deploy plugin is installed.
    // The behavior was fixed in moss v0.3.0 (Bug 5).
    // Only runs in CI with release binary - local dev builds may have different behavior.
    it.skipIf(!IS_CI_BINARY)("shows 'no plugin' message when no deploy plugin installed", async () => {
      const fixture = createFixture({
        withGit: true,
        withRemote: "git@github.com:user/test-repo.git",
        withPlugin: false, // No plugin installed
      });

      const { stdout, stderr, code } = await runMoss(["deploy", fixture]);

      // Should exit with error (no plugin)
      expect(code).toBe(1);
      const output = stdout + stderr;
      expect(output).toMatch(/no.*plugin|install.*plugin/i);
    });

    it("builds before deploying", async () => {
      const fixture = createFixture({
        withGit: true,
        withRemote: "git@github.com:user/test-repo.git",
      });

      const { stdout, stderr } = await runMoss(["deploy", fixture]);

      // Should show compilation step
      const output = stdout + stderr;
      expect(output).toContain("Compiling");

      // Should create .moss/site directory
      const siteDir = path.join(fixture, ".moss", "site");
      expect(fs.existsSync(siteDir)).toBe(true);
    });

    it("shows progress messages", async () => {
      const fixture = createFixture({
        withGit: true,
        withRemote: "git@github.com:user/test-repo.git",
      });

      const { stdout, stderr } = await runMoss(["deploy", fixture]);
      const output = stdout + stderr;

      // Should show deploy step
      expect(output).toContain("Deploying");
    });
  });

  describe("Plugin discovery", () => {
    it("creates plugin directory structure correctly", async () => {
      const fixture = createFixture({
        withPlugin: true,
      });

      // Verify plugin files were copied
      const pluginsDir = path.join(fixture, ".moss", "plugins", "github");
      expect(fs.existsSync(pluginsDir)).toBe(true);
      expect(fs.existsSync(path.join(pluginsDir, "manifest.json"))).toBe(true);
      expect(fs.existsSync(path.join(pluginsDir, "main.bundle.js"))).toBe(true);
    });

    it("manifest.json has correct structure", async () => {
      const fixture = createFixture({
        withPlugin: true,
      });

      const manifestPath = path.join(fixture, ".moss", "plugins", "github", "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      expect(manifest.name).toBe("github");
      expect(manifest.capabilities).toContain("deploy");
      expect(manifest.entry).toBe("main.bundle.js");
      expect(manifest.global_name).toBe("GithubPlugin");
    });
  });

  /**
   * Plugin Execution Tests (with --wait-plugins)
   *
   * These tests use --wait-plugins to wait for plugin hooks to complete.
   * Requires:
   * - moss v0.3.1+ with --wait-plugins support
   * - Display server (xvfb-run on Linux CI)
   *
   * The plugin validation logic runs in the webview and reports errors
   * via Tauri IPC commands which are captured in the CLI output.
   */
  describe("Plugin execution (with --wait-plugins)", () => {
    it.skipIf(!HAS_WAIT_PLUGINS)("reports validation errors for non-git repos", async () => {
      // Create fixture WITHOUT git initialization - plugin should detect this
      const fixture = createFixture({
        withGit: false, // Not a git repo
        withPlugin: true,
      });

      // First build the site (creates .moss/site)
      await runMoss(["build", fixture, "--no-plugins"]);

      // Then deploy - plugin should report "not a git repository" error
      const { stdout, stderr, code } = await runMoss(
        ["deploy", fixture, "--wait-plugins"],
        { timeout: 60000 }
      );

      const output = stdout + stderr;

      // Plugin should have executed and reported validation error
      // The exact error message depends on the plugin implementation
      expect(output).toMatch(/not.*git.*repository|git.*init|Repository setup/i);
    });

    it.skipIf(!HAS_WAIT_PLUGINS)("reports errors for missing remote", async () => {
      // Create git repo WITHOUT remote
      const fixture = createFixture({
        withGit: true,
        withRemote: undefined, // No remote configured
        withPlugin: true,
      });

      // First build the site
      await runMoss(["build", fixture, "--no-plugins"]);

      // Then deploy - plugin should report "no remote" error
      const { stdout, stderr, code } = await runMoss(
        ["deploy", fixture, "--wait-plugins"],
        { timeout: 60000 }
      );

      const output = stdout + stderr;

      // Plugin should report missing remote or show repo setup UI
      expect(output).toMatch(/no.*remote|Repository setup|cancelled/i);
    });

    it.skipIf(!HAS_WAIT_PLUGINS)("reports errors for non-GitHub remote", async () => {
      // Create git repo with GitLab remote (not GitHub)
      const fixture = createFixture({
        withGit: true,
        withRemote: "git@gitlab.com:user/repo.git", // GitLab, not GitHub
        withPlugin: true,
      });

      // First build the site
      await runMoss(["build", fixture, "--no-plugins"]);

      // Then deploy - plugin should report "not a GitHub URL" error
      const { stdout, stderr, code } = await runMoss(
        ["deploy", fixture, "--wait-plugins"],
        { timeout: 60000 }
      );

      const output = stdout + stderr;

      // Plugin should report non-GitHub remote error
      expect(output).toMatch(/not.*GitHub|GitHub.*only|github\.com/i);
    });

    it.skipIf(!HAS_WAIT_PLUGINS)("validates site is built before deploy", async () => {
      // Create fixture with valid GitHub setup but NO built site
      const fixture = createFixture({
        withGit: true,
        withRemote: "git@github.com:testuser/testrepo.git",
        withPlugin: true,
      });

      // Do NOT build - go straight to deploy
      // Plugin should report "no site files" error
      const { stdout, stderr, code } = await runMoss(
        ["deploy", fixture, "--wait-plugins"],
        { timeout: 60000 }
      );

      const output = stdout + stderr;

      // Plugin should report empty site or compilation needed
      expect(output).toMatch(/site.*empty|build.*first|no.*files/i);
    });

    it.skipIf(!HAS_WAIT_PLUGINS)("shows deploy progress messages", async () => {
      // Create fixture with valid GitHub setup
      const fixture = createFixture({
        withGit: true,
        withRemote: "git@github.com:testuser/testrepo.git",
        withPlugin: true,
      });

      // Build first
      await runMoss(["build", fixture, "--no-plugins"]);

      // Deploy with --wait-plugins to see full output
      const { stdout, stderr, code } = await runMoss(
        ["deploy", fixture, "--wait-plugins"],
        { timeout: 120000 } // Longer timeout for full deploy
      );

      const output = stdout + stderr;

      // Should show deploy-related messages
      // Note: actual deployment will fail without real git push,
      // but we should see the validation passing and deploy starting
      expect(output).toMatch(/deploy|GitHub|validat/i);
    });
  });

  /**
   * Build with plugins tests
   *
   * Tests compilation with plugins enabled (no --no-plugins flag).
   * The GitHub plugin has deploy capability, not process/enhance,
   * so it won't affect compilation, but this verifies plugin loading works.
   */
  describe("Build with plugins", () => {
    it.skipIf(!HAS_WAIT_PLUGINS)("builds successfully with plugin installed", async () => {
      const fixture = createFixture({
        withGit: true,
        withRemote: "git@github.com:testuser/testrepo.git",
        withPlugin: true,
        content: {
          "index.md": "# Test Site\n\nHello world!",
        },
      });

      // Build WITH plugins (default behavior)
      const { stdout, stderr, code } = await runMoss(
        ["build", fixture, "--wait-plugins"],
        { timeout: 60000 }
      );

      // Should succeed
      expect(code).toBe(0);

      // Should create site directory
      const siteDir = path.join(fixture, ".moss", "site");
      expect(fs.existsSync(siteDir)).toBe(true);

      // Should have generated HTML
      const indexHtml = path.join(siteDir, "index.html");
      expect(fs.existsSync(indexHtml)).toBe(true);
    });
  });
});
