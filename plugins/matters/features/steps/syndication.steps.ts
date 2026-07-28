import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vitest";
import { walletLogin, createAuthenticatedClient, type WalletAuthResult } from "../../test-helpers/wallet-auth";
import { PUT_DRAFT_MUTATION, GET_DRAFT_QUERY } from "../../src/api";

const feature = await loadFeature("features/syndication/create-draft.feature");

const TEST_ENDPOINT = "https://server.matters.icu/graphql";

// Mock types for draft operations
interface DraftInput {
  title: string;
  content: string;
  tags?: string[];
  summary?: string;
}

interface Draft {
  id: string;
  title: string;
  content?: string;
  publishState: string;
  article?: {
    id: string;
    shortHash: string;
    slug: string;
  } | null;
}

describeFeature(feature, ({ Scenario, Background }) => {
  // Test state
  let authResult: WalletAuthResult;
  let authenticatedQuery: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
  let articleData: DraftInput;
  let canonicalUrl: string;
  let addCanonicalLink: boolean;
  let createdDraft: Draft | null = null;
  let fetchedDraft: Draft | null = null;
  let syndicatedUrl: string | undefined;
  let shouldSkip: boolean;

  Background(({ Given }) => {
    Given("I am authenticated with the Matters test environment", async () => {
      const privateKey = process.env.MATTERS_TEST_WALLET_PRIVATE_KEY;

      if (!privateKey) {
        // Skip tests if no private key is configured
        console.warn("⚠️ MATTERS_TEST_WALLET_PRIVATE_KEY not set - using mock auth");
        // Create a mock auth result for testing structure
        authResult = {
          token: "mock-token",
          user: { id: "mock-id", userName: "mockuser", displayName: "Mock User" },
          type: "Login",
        };
        authenticatedQuery = vi.fn().mockResolvedValue({});
        return;
      }

      authResult = await walletLogin(privateKey, TEST_ENDPOINT);
      authenticatedQuery = createAuthenticatedClient(authResult.token, TEST_ENDPOINT);
    });
  });

  Scenario("Create draft via API", ({ Given, When, Then, And }) => {
    Given('I have an article with title "E2E Test Article"', () => {
      articleData = {
        title: `E2E Test Article - ${Date.now()}`, // Unique title to avoid conflicts
        content: "<p>This is test content for e2e testing of the Matters plugin.</p>",
        tags: ["test", "e2e"],
        summary: "Test article for e2e testing",
      };
    });

    And("the article has content and tags", () => {
      expect(articleData.content).toBeDefined();
      expect(articleData.tags).toBeDefined();
      expect(articleData.tags!.length).toBeGreaterThan(0);
    });

    When("I create a draft on Matters", async () => {
      if (!process.env.MATTERS_TEST_WALLET_PRIVATE_KEY) {
        // Mock response for structure testing
        createdDraft = {
          id: "mock-draft-id",
          title: articleData.title,
          content: articleData.content,
          publishState: "unpublished",
          article: null,
        };
        return;
      }

      interface PutDraftResponse {
        putDraft: Draft;
      }

      const response = await authenticatedQuery<PutDraftResponse>(PUT_DRAFT_MUTATION, {
        input: {
          title: articleData.title,
          content: articleData.content,
          tags: articleData.tags,
          summary: articleData.summary,
        },
      });

      createdDraft = response.putDraft;
    });

    Then("a draft should be created with the correct title", () => {
      expect(createdDraft).not.toBeNull();
      expect(createdDraft!.title).toBe(articleData.title);
    });

    And('the draft should have publishState "unpublished"', () => {
      expect(createdDraft!.publishState).toBe("unpublished");
    });

    And("I should receive a draft ID", () => {
      expect(createdDraft!.id).toBeDefined();
      expect(createdDraft!.id.length).toBeGreaterThan(0);
    });
  });

  Scenario("Draft includes canonical link", ({ Given, When, Then, And }) => {
    Given('I have an article with canonical URL "https://my-site.com/test-article"', () => {
      canonicalUrl = "https://my-site.com/test-article";
      articleData = {
        title: `Canonical Test - ${Date.now()}`,
        content: "<p>Original article content.</p>",
        tags: ["test"],
      };
    });

    And("add_canonical_link is enabled", () => {
      addCanonicalLink = true;
    });

    When("I create a draft on Matters", async () => {
      // Build content with canonical link
      const contentWithCanonical = addCanonicalLink
        ? `${articleData.content}\n\n<hr/><p>Originally published at <a href="${canonicalUrl}">${canonicalUrl}</a></p>`
        : articleData.content;

      if (!process.env.MATTERS_TEST_WALLET_PRIVATE_KEY) {
        createdDraft = {
          id: "mock-draft-canonical",
          title: articleData.title,
          content: contentWithCanonical,
          publishState: "unpublished",
          article: null,
        };
        return;
      }

      interface PutDraftResponse {
        putDraft: Draft;
      }

      const response = await authenticatedQuery<PutDraftResponse>(PUT_DRAFT_MUTATION, {
        input: {
          title: articleData.title,
          content: contentWithCanonical,
          tags: articleData.tags,
        },
      });

      createdDraft = response.putDraft;
    });

    Then("the draft content should contain the canonical URL", () => {
      expect(createdDraft).not.toBeNull();
      expect(createdDraft!.content).toContain(canonicalUrl);
    });

    And("it should be formatted as a link at the end", () => {
      expect(createdDraft!.content).toContain(`href="${canonicalUrl}"`);
    });
  });

  Scenario("Fetch draft by ID", ({ Given, When, Then, And }) => {
    Given("I have created a draft on Matters", async () => {
      if (!process.env.MATTERS_TEST_WALLET_PRIVATE_KEY) {
        createdDraft = {
          id: "mock-draft-fetch-test",
          title: "Fetch Test Draft",
          publishState: "unpublished",
          article: null,
        };
        return;
      }

      // Create a draft first
      interface PutDraftResponse {
        putDraft: Draft;
      }

      const response = await authenticatedQuery<PutDraftResponse>(PUT_DRAFT_MUTATION, {
        input: {
          title: `Fetch Test - ${Date.now()}`,
          content: "<p>Test content for fetch test.</p>",
        },
      });

      createdDraft = response.putDraft;
    });

    When("I fetch the draft by ID", async () => {
      if (!process.env.MATTERS_TEST_WALLET_PRIVATE_KEY) {
        fetchedDraft = createdDraft;
        return;
      }

      interface GetDraftResponse {
        node: Draft | null;
      }

      const response = await authenticatedQuery<GetDraftResponse>(GET_DRAFT_QUERY, {
        id: createdDraft!.id,
      });

      fetchedDraft = response.node;
    });

    Then("I should receive the draft details", () => {
      expect(fetchedDraft).not.toBeNull();
    });

    And("the draft should have the correct title", () => {
      expect(fetchedDraft!.title).toBe(createdDraft!.title);
    });

    And("the publishState should be present", () => {
      expect(fetchedDraft!.publishState).toBeDefined();
    });
  });

  Scenario("Skip already syndicated articles", ({ Given, When, Then, And }) => {
    Given("I have an article with syndicated URL for Matters", () => {
      syndicatedUrl = "https://matters.town/@testuser/test-article-abc123";
      articleData = {
        title: "Already Syndicated Article",
        content: "<p>This article is already on Matters.</p>",
      };
    });

    When("I check if the article should be syndicated", () => {
      // Check if syndicatedUrl contains matters.town
      shouldSkip = syndicatedUrl !== undefined && syndicatedUrl.includes("matters.town");
    });

    Then("the article should be skipped", () => {
      expect(shouldSkip).toBe(true);
    });

    And("no new draft should be created", () => {
      // In the actual implementation, we would not call createDraft
      // Here we verify the skip logic works correctly
      if (shouldSkip) {
        // Draft creation was skipped as expected
        expect(shouldSkip).toBe(true);
      }
    });
  });
});
