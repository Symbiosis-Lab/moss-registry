import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { describe, expect, it } from "vitest";
import { walletLogin, createAuthenticatedClient, type WalletAuthResult } from "../../test-helpers/wallet-auth";
import { PUT_DRAFT_MUTATION, GET_DRAFT_QUERY } from "../../src/api";

const feature = await loadFeature("features/syndication/create-draft.feature");

const TEST_ENDPOINT = "https://server.matters.icu/graphql";

// Live suite: these scenarios exercise the REAL putDraft/getDraft mutations
// against server.matters.icu. Without the key this file used to substitute a
// hand-built fake draft object and pass green while asserting nothing about
// Matters — so an unset key now skips the whole feature loudly instead.
const TEST_WALLET_KEY = process.env.MATTERS_TEST_WALLET_PRIVATE_KEY ?? "";

if (!TEST_WALLET_KEY) {
  describe.skip("Draft creation against matters.icu", () => {
    it("requires MATTERS_TEST_WALLET_PRIVATE_KEY (see test-helpers/TEST_ACCOUNT.md)", () => {});
  });
}

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

interface PutDraftResponse {
  putDraft: Draft;
}

if (TEST_WALLET_KEY)
  describeFeature(feature, ({ Scenario, Background }) => {
    // Test state
    let authResult: WalletAuthResult;
    let authenticatedQuery: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
    let articleData: DraftInput;
    let canonicalUrl: string;
    let addCanonicalLink: boolean;
    let createdDraft: Draft | null = null;
    let fetchedDraft: Draft | null = null;

    Background(({ Given }) => {
      Given("I am authenticated with the Matters test environment", async () => {
        authResult = await walletLogin(TEST_WALLET_KEY, TEST_ENDPOINT);
        authenticatedQuery = createAuthenticatedClient(authResult.token, TEST_ENDPOINT);
      });
    });

    Scenario("Create draft via API", ({ Given, And, When, Then }) => {
      Given('I have an article with title "E2E Test Article"', () => {
        articleData = {
          title: `E2E Test Article - ${Date.now()}`,
          content: "<p>This is a test article created by e2e tests.</p>",
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
        const response = await authenticatedQuery<PutDraftResponse>(PUT_DRAFT_MUTATION, {
          input: {
            title: `Fetch Test - ${Date.now()}`,
            content: "<p>Test content for fetch test.</p>",
          },
        });

        createdDraft = response.putDraft;
      });

      When("I fetch the draft by ID", async () => {
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
  });
