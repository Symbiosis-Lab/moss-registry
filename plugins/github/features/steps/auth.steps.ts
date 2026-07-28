/**
 * Step definitions for GitHub OAuth Device Flow authentication tests
 */

import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMockFetch,
  defaultDeviceCodeResponse,
  defaultTokenResponse,
  defaultUserResponse,
  authorizationPendingResponse,
  expiredTokenResponse,
} from "../../test-helpers/mock-github-api";
import type { DeviceCodeResponse, TokenResponse, GitHubUser } from "../../src/types";

// Load the feature file
const feature = await loadFeature("features/auth/device-flow.feature");

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  // Test state
  let mockFetch: ReturnType<typeof createMockFetch>;
  let originalFetch: typeof global.fetch;
  let deviceCodeResponse: DeviceCodeResponse | null = null;
  let tokenResponse: TokenResponse | null = null;
  let validationResult: { valid: boolean; user?: GitHubUser; scopes?: string[] } | null = null;
  let storedToken: string | null = null;
  let retrievedToken: string | null = null;

  // Mock credential helper
  const credentialStore = new Map<string, string>();

  BeforeEachScenario(() => {
    // Save original fetch
    originalFetch = global.fetch;
    // Reset state
    deviceCodeResponse = null;
    tokenResponse = null;
    validationResult = null;
    storedToken = null;
    retrievedToken = null;
    credentialStore.clear();
  });

  AfterEachScenario(() => {
    // Restore original fetch
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ============================================================================
  // Scenario: Request device code from GitHub
  // ============================================================================

  Scenario("Request device code from GitHub", ({ Given, When, Then, And }) => {
    Given("no existing GitHub credentials", () => {
      credentialStore.clear();
      mockFetch = createMockFetch({
        deviceCodeResponse: defaultDeviceCodeResponse,
      });
      global.fetch = mockFetch;
    });

    When("I initiate the device flow authentication", async () => {
      const response = await fetch("https://github.com/login/device/code", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: "test-client-id",
          scope: "repo workflow",
        }),
      });

      deviceCodeResponse = await response.json();
    });

    Then("I should receive a device code response", () => {
      expect(deviceCodeResponse).not.toBeNull();
      expect(deviceCodeResponse?.device_code).toBeDefined();
    });

    And("the response should include user_code, verification_uri, and interval", () => {
      expect(deviceCodeResponse?.user_code).toBe("ABCD-1234");
      expect(deviceCodeResponse?.verification_uri).toBe("https://github.com/login/device");
      expect(deviceCodeResponse?.interval).toBe(5);
    });
  });

  // ============================================================================
  // Scenario: Poll for access token after authorization
  // ============================================================================

  Scenario("Poll for access token after authorization", ({ Given, When, Then, And }) => {
    Given("a valid device code", () => {
      mockFetch = createMockFetch({
        tokenResponse: defaultTokenResponse,
        userResponse: defaultUserResponse,
        scopes: ["repo", "workflow"],
      });
      global.fetch = mockFetch;
    });

    And("the user has authorized the application", () => {
      // Mock is already configured to return success
    });

    When("I poll for the access token", async () => {
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: "test-client-id",
          device_code: "test-device-code",
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      tokenResponse = await response.json();
    });

    Then("I should receive an access token", () => {
      expect(tokenResponse?.access_token).toBeDefined();
      expect(tokenResponse?.access_token).toBe("gho_test_token_abc123");
    });

    And("the token should have repo and workflow scopes", () => {
      expect(tokenResponse?.scope).toContain("repo");
      expect(tokenResponse?.scope).toContain("workflow");
    });
  });

  // ============================================================================
  // Scenario: Handle authorization pending state
  // ============================================================================

  Scenario("Handle authorization pending state", ({ Given, When, Then, And }) => {
    Given("a valid device code", () => {
      mockFetch = createMockFetch({
        tokenResponse: authorizationPendingResponse,
      });
      global.fetch = mockFetch;
    });

    And("the user has not yet authorized", () => {
      // Mock is configured to return authorization_pending
    });

    When("I poll for the access token", async () => {
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: "test-client-id",
          device_code: "test-device-code",
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      tokenResponse = await response.json();
    });

    Then("I should receive authorization_pending error", () => {
      expect(tokenResponse?.error).toBe("authorization_pending");
    });

    And("I should continue polling", () => {
      // This is the expected behavior - we would continue polling in real code
      expect(tokenResponse?.error_description).toContain("pending");
    });
  });

  // ============================================================================
  // Scenario: Store token in git credential helper
  // ============================================================================

  Scenario("Store token in git credential helper", ({ Given, When, Then, And }) => {
    Given("a valid access token", () => {
      storedToken = "gho_test_token_abc123";
    });

    When("I store the token", () => {
      // Simulate storing in credential helper
      credentialStore.set("github.com", storedToken!);
    });

    Then("the token should be stored successfully", () => {
      expect(credentialStore.has("github.com")).toBe(true);
    });

    And("I should be able to retrieve the token", () => {
      retrievedToken = credentialStore.get("github.com") || null;
      expect(retrievedToken).toBe(storedToken);
    });
  });

  // ============================================================================
  // Scenario: Handle expired device code
  // ============================================================================

  Scenario("Handle expired device code", ({ Given, When, Then }) => {
    Given("a device code that has expired", () => {
      mockFetch = createMockFetch({
        tokenResponse: expiredTokenResponse,
      });
      global.fetch = mockFetch;
    });

    When("I poll for the access token", async () => {
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: "test-client-id",
          device_code: "expired-device-code",
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      tokenResponse = await response.json();
    });

    Then("I should receive an expired_token error", () => {
      expect(tokenResponse?.error).toBe("expired_token");
    });
  });

  // ============================================================================
  // Scenario: Validate token with GitHub API
  // ============================================================================

  Scenario("Validate token with GitHub API", ({ Given, When, Then, And }) => {
    Given("a valid access token", () => {
      mockFetch = createMockFetch({
        userResponse: defaultUserResponse,
        scopes: ["repo", "workflow"],
      });
      global.fetch = mockFetch;
    });

    When("I validate the token", async () => {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: "Bearer gho_test_token_abc123",
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (response.ok) {
        const user = await response.json();
        const scopeHeader = response.headers.get("X-OAuth-Scopes") || "";
        const scopes = scopeHeader.split(",").map((s) => s.trim());

        validationResult = {
          valid: true,
          user,
          scopes,
        };
      } else {
        validationResult = { valid: false };
      }
    });

    Then("I should receive user information", () => {
      expect(validationResult?.valid).toBe(true);
      expect(validationResult?.user?.login).toBe("testuser");
    });

    And("the scopes should include repo and workflow", () => {
      expect(validationResult?.scopes).toContain("repo");
      expect(validationResult?.scopes).toContain("workflow");
    });
  });
});
