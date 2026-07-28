/**
 * E2E Tests for Matters Plugin using moss CLI
 *
 * These tests verify the Matters plugin works correctly when invoked through
 * the moss CLI, testing real-world scenarios.
 *
 * The Matters plugin has capabilities:
 * - process: Syncs articles from Matters.town during build
 * - syndicate: Publishes articles to Matters.town after deploy
 *
 * Requirements:
 * - moss binary with --wait-plugins support (v0.3.1+)
 * - Plugin built (npm run build)
 * - Display server available (xvfb-run on Linux CI)
 *
 * Note: Tests verify graceful handling when not authenticated.
 * Full integration tests with real Matters API require authentication.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Path to moss binary - check env var first, then fallback to local dev path
const MOSS_BINARY =
  process.env.MOSS_BINARY ||
  path.join(__dirname, "../../../../moss/develop/src-tauri/target/debug/moss");

// Check if --wait-plugins is supported (v0.3.1+)
let HAS_WAIT_PLUGINS = false;

// Path to plugin dist
const PLUGIN_DIST = path.join(__dirname, "../dist");

// Test fixture directory
let testDir: string;
let fixtureCounter = 0;

/**
 * Create a test fixture directory with optional configuration
 */
function createFixture(options: {
  withGit?: boolean;
  withRemote?: string;
  withPlugin?: boolean;
  withMattersConfig?: Record<string, unknown>;
  content?: Record<string, string>;
}): string {
  const fixtureName = `moss-matters-e2e-${Date.now()}-${fixtureCounter++}`;
  const fixturePath = path.join(testDir, fixtureName);
  fs.mkdirSync(fixturePath, { recursive: true });

  // Create content files
  const defaultContent = {
    "index.md": "# Hello World\n\nThis is a test site.",
    "posts/article1.md": `---
title: Test Article
date: 2024-01-01
tags:
  - test
---

# Test Article

This is a test article for Matters plugin testing.
`,
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

    if (options.withRemote) {
      execSync(`git remote add origin ${options.withRemote}`, {
        cwd: fixturePath,
        stdio: "pipe",
      });
    }
  }

  // Install plugin if requested
  if (options.withPlugin) {
    const mossDir = path.join(fixturePath, ".moss");
    const pluginsDir = path.join(mossDir, "plugins");
    const mattersPluginDir = path.join(pluginsDir, "matters");

    fs.mkdirSync(mattersPluginDir, { recursive: true });

    // Copy plugin files
    const pluginFiles = ["main.bundle.js", "manifest.json", "icon.svg"];
    for (const file of pluginFiles) {
      const src = path.join(PLUGIN_DIST, file);
      const dest = path.join(mattersPluginDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }

    // Write plugin config if provided
    if (options.withMattersConfig) {
      const configPath = path.join(mattersPluginDir, "config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify(options.withMattersConfig, null, 2)
      );
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

describe("Matters Plugin E2E Tests", () => {
  beforeAll(async () => {
    // Verify moss binary exists
    if (!fs.existsSync(MOSS_BINARY)) {
      throw new Error(
        `moss binary not found at ${MOSS_BINARY}. ` +
          `Set MOSS_BINARY environment variable or build moss locally.`
      );
    }

    // Verify plugin dist exists
    if (!fs.existsSync(PLUGIN_DIST)) {
      throw new Error(
        `Plugin dist not found at ${PLUGIN_DIST}. Run 'npm run build' first.`
      );
    }

    // Create temp directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "moss-matters-e2e-"));

    // Check if --wait-plugins is supported
    const { stdout } = await runMoss(["--help"]);
    HAS_WAIT_PLUGINS = stdout.includes("--wait-plugins");
  });

  afterAll(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Plugin discovery", () => {
    it("has correct manifest structure", () => {
      const fixture = createFixture({ withPlugin: true });

      const manifestPath = path.join(
        fixture,
        ".moss",
        "plugins",
        "matters",
        "manifest.json"
      );
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      expect(manifest.name).toBe("matters");
      expect(manifest.capabilities).toContain("process");
      expect(manifest.capabilities).toContain("syndicate");
      expect(manifest.domain).toBe("matters.town");
      expect(manifest.entry).toBe("main.bundle.js");
    });

    it("plugin files are copied correctly", () => {
      const fixture = createFixture({ withPlugin: true });

      const pluginDir = path.join(fixture, ".moss", "plugins", "matters");
      expect(fs.existsSync(path.join(pluginDir, "manifest.json"))).toBe(true);
      expect(fs.existsSync(path.join(pluginDir, "main.bundle.js"))).toBe(true);
    });
  });

  /**
   * Process Hook Tests
   *
   * The process hook syncs articles from Matters.town.
   * Without authentication, it should gracefully handle the missing auth
   * and continue with the build (or show auth prompt).
   */
  describe("Process hook (with --wait-plugins)", () => {
    it.skipIf(!HAS_WAIT_PLUGINS)(
      "builds with matters plugin - handles missing auth gracefully",
      async () => {
        const fixture = createFixture({
          withPlugin: true,
          content: {
            "index.md": "# My Blog\n\nWelcome!",
            "posts/hello.md": `---
title: Hello World
date: 2024-01-01
---

Hello from my blog!
`,
          },
        });

        // Build with plugins - process hook will run
        const { stdout, stderr, code } = await runMoss(
          ["build", fixture, "--wait-plugins"],
          { timeout: 60000 }
        );

        const output = stdout + stderr;

        // Compilation should succeed (plugin handles auth gracefully)
        // The site should be generated regardless of Matters sync status
        expect(code).toBe(0);

        // Site should be created
        const siteDir = path.join(fixture, ".moss", "site");
        expect(fs.existsSync(siteDir)).toBe(true);

        // Output should mention Matters or process hook activity
        // Could be auth prompt, sync status, or graceful skip
        // The exact message depends on plugin behavior
        expect(output).toMatch(/matters|process|sync|compil/i);
      }
    );

    it.skipIf(!HAS_WAIT_PLUGINS)(
      "shows waiting messages for process hook",
      async () => {
        const fixture = createFixture({
          withPlugin: true,
          content: {
            "index.md": "# Test\n\nContent",
          },
        });

        const { stdout, stderr, code } = await runMoss(
          ["build", fixture, "--wait-plugins"],
          { timeout: 60000 }
        );

        const output = stdout + stderr;

        // Should show hook waiting messages (from --wait-plugins)
        expect(output).toMatch(/waiting|hook|before_build|process/i);
      }
    );
  });

  /**
   * Build Integration Tests
   *
   * Tests that the plugin doesn't break normal build flow.
   */
  describe("Build integration", () => {
    it.skipIf(!HAS_WAIT_PLUGINS)(
      "build completes even when matters sync fails",
      async () => {
        const fixture = createFixture({
          withPlugin: true,
          withMattersConfig: {
            // No username configured - sync will fail gracefully
            sync_on_build: true,
          },
          content: {
            "index.md": "# Blog\n\nWelcome to my blog.",
          },
        });

        const { stdout, stderr, code } = await runMoss(
          ["build", fixture, "--wait-plugins"],
          { timeout: 60000 }
        );

        // Build should still complete successfully
        expect(code).toBe(0);

        // Site should be generated
        const siteDir = path.join(fixture, ".moss", "site");
        expect(fs.existsSync(siteDir)).toBe(true);
      }
    );
  });
});
