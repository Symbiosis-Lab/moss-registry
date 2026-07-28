/**
 * Step definitions for GitHub Deployer validation tests
 *
 * Uses @symbiosis-lab/moss-api/testing to mock Tauri IPC commands
 *
 * Updated for git-origin-based deploy target (no config.json, no validation.ts).
 */

import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vitest";
import {
  setupMockTauri,
  type MockTauriContext,
} from "@symbiosis-lab/moss-api/testing";
import type { DeployContext, HookResult } from "../../src/types";

// Load the feature file
const feature = await loadFeature("features/deploy/validation.feature");

// Mock the utils module
vi.mock("../../src/utils", () => ({
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  reportComplete: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  showToast: vi.fn().mockResolvedValue(undefined),
  dismissToast: vi.fn().mockResolvedValue(undefined),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// Mock the github-deploy module
vi.mock("../../src/github-deploy", () => ({
  verifyRepoExists: vi.fn().mockResolvedValue(undefined),
  getOriginOwnerRepo: vi.fn(),
  deployViaGitPush: vi.fn(),
}));

// Mock the auth module
vi.mock("../../src/auth", () => ({
  promptLogin: vi.fn(),
  checkAuthentication: vi.fn(),
  validateToken: vi.fn(),
  hasRequiredScopes: vi.fn(),
}));

// Mock the token module
vi.mock("../../src/token", () => ({
  getToken: vi.fn(),
  getTokenFromGit: vi.fn(),
  storeToken: vi.fn(),
  clearToken: vi.fn(),
}));

// Mock the git module (only pure functions still imported by main.ts)
vi.mock("../../src/git", () => ({
  buildPagesUrl: vi.fn().mockImplementation((owner: string, repo: string) => {
    if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
      return `https://${owner}.github.io`;
    }
    return `https://${owner}.github.io/${repo}`;
  }),
  parseGitHubUrl: vi.fn().mockImplementation((remoteUrl: string) => {
    const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (m) return { owner: m[1], repo: m[2] };
    return null;
  }),
}));

// Mock the repo-setup module
vi.mock("../../src/repo-setup", () => ({
  ensureGitHubRepo: vi.fn(),
}));

// Mock the github-api module
vi.mock("../../src/github-api", () => ({
  checkPagesStatus: vi.fn().mockResolvedValue({ status: "built" }),
  getAuthenticatedUser: vi.fn(),
  checkRepoExists: vi.fn(),
  createRepository: vi.fn(),
  setCustomDomain: vi.fn(),
}));

// Import after mocking
const { on_deploy } = await import("../../src/main");
const { deployViaGitPush, getOriginOwnerRepo } = await import("../../src/github-deploy");
const { getToken, getTokenFromGit } = await import("../../src/token");
const { parseGitHubUrl, buildPagesUrl } = await import("../../src/git");
const { checkPagesStatus } = await import("../../src/github-api");
const { ensureGitHubRepo } = await import("../../src/repo-setup");

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  // Test state
  let ctx: MockTauriContext;
  let projectPath: string;
  let deployResult: HookResult | null = null;
  let scenarioSiteFiles: string[] = ["index.html"]; // Default site files

  /**
   * Create a mock DeployContext for testing
   */
  function createMockContext(): DeployContext {
    return {
      project_path: projectPath,
      moss_dir: `${projectPath}/.moss`,
      output_dir: `${projectPath}/.moss/build/site`,
      site_files: scenarioSiteFiles,
      project_info: {
        project_type: "markdown",
        content_folders: ["posts"],
        total_files: 10,
        homepage_file: "index.md",
      },
      config: {},
    };
  }

  BeforeEachScenario(() => {
    ctx = setupMockTauri();
    projectPath = "/test/project";
    deployResult = null;
    scenarioSiteFiles = ["index.html"]; // Reset to default
    vi.clearAllMocks();

    // Restore default implementations after clearAllMocks
    vi.mocked(parseGitHubUrl).mockImplementation((remoteUrl: string) => {
      const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (m) return { owner: m[1], repo: m[2] };
      return null;
    });
    vi.mocked(buildPagesUrl).mockImplementation((owner: string, repo: string) => {
      if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
        return `https://${owner}.github.io`;
      }
      return `https://${owner}.github.io/${repo}`;
    });
    vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });
    // Default: no git origin (first-time user)
    vi.mocked(getOriginOwnerRepo).mockResolvedValue(null);
  });

  AfterEachScenario(() => {
    ctx.cleanup();
  });

  // ============================================================================
  // Scenario: Deploy from non-git directory shows repo setup UI
  // No .git origin → ensureGitHubRepo → user cancels → "cancelled"
  // ============================================================================

  Scenario("Deploy from non-git directory", ({ Given, When, Then, And }) => {
    Given("the directory is not a git repository", () => {
      // No git origin (no .git directory)
      vi.mocked(getOriginOwnerRepo).mockResolvedValue(null);
      // ensureGitHubRepo returns null (user cancelled)
      vi.mocked(ensureGitHubRepo).mockResolvedValue(null);
    });

    When("I attempt to deploy", async () => {
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should fail", () => {
      expect(deployResult?.success).toBe(false);
    });

    And('the error should indicate setup was cancelled', () => {
      expect(deployResult?.message).toContain("cancelled");
    });
  });

  // ============================================================================
  // Scenario: Deploy without any git remote
  // Same as above: no origin → ensureGitHubRepo → user cancels
  // ============================================================================

  Scenario("Deploy without any git remote", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      // Git repo exists but no GitHub origin
      vi.mocked(getOriginOwnerRepo).mockResolvedValue(null);
    });

    And("no git remote is configured", () => {
      // ensureGitHubRepo returns null (user cancelled)
      vi.mocked(ensureGitHubRepo).mockResolvedValue(null);
    });

    When("I attempt to deploy", async () => {
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should fail", () => {
      expect(deployResult?.success).toBe(false);
    });

    And('the error should mention "No git remote configured"', () => {
      // In new flow: shows repo setup UI, returns cancelled when no interaction
      expect(deployResult?.message).toContain("cancelled");
    });

    And("the error should include instructions to add a GitHub remote", () => {
      expect(deployResult?.message).toContain("Repository setup cancelled");
    });
  });

  // ============================================================================
  // Scenario: Deploy with non-GitHub remote triggers setup
  // getOriginOwnerRepo returns null for non-GitHub → ensureGitHubRepo → cancelled
  // ============================================================================

  Scenario("Deploy with non-GitHub remote triggers setup", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      // Non-GitHub origin → getOriginOwnerRepo returns null
      vi.mocked(getOriginOwnerRepo).mockResolvedValue(null);
    });

    And("the git remote is not a GitHub URL", () => {
      // ensureGitHubRepo returns null (user cancelled)
      vi.mocked(ensureGitHubRepo).mockResolvedValue(null);
    });

    When("I attempt to deploy", async () => {
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should fail", () => {
      expect(deployResult?.success).toBe(false);
    });

    And('the error should indicate setup was cancelled', () => {
      expect(deployResult?.message).toContain("cancelled");
    });
  });

  // ============================================================================
  // Scenario: Deploy with empty site directory
  // ============================================================================

  Scenario("Deploy with empty site directory", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      // Git origin exists
      vi.mocked(getOriginOwnerRepo).mockResolvedValue({ owner: "user", repo: "repo" });
    });

    And("the site directory is empty", () => {
      scenarioSiteFiles = [];
    });

    When("I attempt to deploy", async () => {
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should fail", () => {
      expect(deployResult?.success).toBe(false);
    });

    And("the error should mention that the site needs to be built", () => {
      expect(deployResult?.message).toMatch(/site.*empty|build.*first|not found/i);
    });
  });

  // ============================================================================
  // Scenario: Successful deployment with SSH remote
  // ============================================================================

  Scenario("Successful deployment with SSH remote", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      // Git origin returns testuser/testrepo
      vi.mocked(getOriginOwnerRepo).mockResolvedValue({ owner: "testuser", repo: "testrepo" });
    });

    And('the git remote is "git@github.com:testuser/testrepo.git"', () => {
      // Already set via getOriginOwnerRepo in Given
    });

    And('the site is built with files in ".moss/build/site/"', () => {
      ctx.filesystem.setFile(`${projectPath}/.moss/build/site/index.html`, "<html></html>");
    });

    And("the GitHub Actions workflow already exists", () => {
      // Token available
      vi.mocked(getToken).mockResolvedValue("test-token");
      vi.mocked(getTokenFromGit).mockResolvedValue(null);

      // deployViaGitPush returns DeployResult
      vi.mocked(deployViaGitPush).mockResolvedValue({ commitSha: "new-commit-sha", orphanSha: "orphan-sha", treeChanged: true });

      // Pages status check
      vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });
    });

    When("I attempt to deploy", async () => {
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should succeed", () => {
      expect(deployResult?.success).toBe(true);
    });

    And('the deployment URL should be "https://testuser.github.io/testrepo"', () => {
      expect(deployResult?.deployment?.url).toBe("https://testuser.github.io/testrepo");
    });
  });

  // ============================================================================
  // Scenario: First-time deployment creates workflow
  // getOriginOwnerRepo returns null → ensureGitHubRepo → setup + deploy
  // ============================================================================

  Scenario("First-time deployment creates workflow", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      // No git origin (first-time deploy)
      vi.mocked(getOriginOwnerRepo).mockResolvedValue(null);
    });

    And('the git remote is "git@github.com:user/repo.git"', () => {
      // ensureGitHubRepo returns repo info (auto-created or via UI)
      vi.mocked(ensureGitHubRepo).mockResolvedValue({
        name: "repo",
        sshUrl: "git@github.com:user/repo.git",
        fullName: "user/repo",
      });
    });

    And('the site is built with files in ".moss/build/site/"', () => {
      ctx.filesystem.setFile(`${projectPath}/.moss/build/site/index.html`, "<html></html>");
      ctx.filesystem.setFile(`${projectPath}/.gitignore`, "node_modules/");
    });

    And("the GitHub Actions workflow does not exist", () => {
      // Token available
      vi.mocked(getToken).mockResolvedValue("test-token");
      vi.mocked(getTokenFromGit).mockResolvedValue(null);

      // deployViaGitPush returns DeployResult
      vi.mocked(deployViaGitPush).mockResolvedValue({ commitSha: "first-commit-sha", orphanSha: "orphan-sha", treeChanged: true });

      // Pages status check
      vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });
    });

    When("I attempt to deploy", async () => {
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should succeed", () => {
      expect(deployResult?.success).toBe(true);
    });

    And("the result should indicate first-time setup", () => {
      expect(deployResult?.deployment?.metadata?.was_first_setup).toBe("true");
    });
  });
});
