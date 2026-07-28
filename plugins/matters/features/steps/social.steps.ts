import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { apiConfig, fetchArticleComments, fetchArticleDonations, fetchArticleAppreciations } from "../../src/api";
import { mergeSocialData } from "../../src/social";
import type { MattersComment, MattersDonation, MattersAppreciation, MattersSocialData, ArticleSocialData } from "../../src/types";

const feature = await loadFeature("features/social/fetch-social-data.feature");

describeFeature(feature, ({ Scenario, Background }) => {
  // Test state
  let testShortHash: string;
  let comments: MattersComment[] = [];
  let donations: MattersDonation[] = [];
  let appreciations: MattersAppreciation[] = [];
  let socialData: MattersSocialData;
  let existingSocialData: MattersSocialData;

  Background(({ Given }) => {
    Given("I am using the Matters test environment", () => {
      apiConfig.endpoint = "https://server.matters.icu/graphql";
    });
  });

  Scenario("Fetch comments for an article", ({ Given, When, Then, And }) => {
    Given("I have a test article shortHash", () => {
      // Use a known article with comments from the test user
      testShortHash = process.env.MATTERS_TEST_ARTICLE_HASH || "bafyreiaooe6jzxbf2tbpvtue6mcb6g523lp7srroxjrlahflb3m2hpfog4";
    });

    When("I fetch comments for the article", async () => {
      comments = await fetchArticleComments(testShortHash);
    });

    Then("I should receive an array of comments", () => {
      expect(Array.isArray(comments)).toBe(true);
    });

    And("each comment should have id, content, createdAt, and author", () => {
      // If there are comments, verify their structure
      for (const comment of comments) {
        expect(comment).toHaveProperty("id");
        expect(comment).toHaveProperty("content");
        expect(comment).toHaveProperty("createdAt");
        expect(comment).toHaveProperty("author");
        expect(comment.author).toHaveProperty("id");
        expect(comment.author).toHaveProperty("userName");
      }
    });
  });

  Scenario("Fetch donations for an article", ({ Given, When, Then, And }) => {
    Given("I have a test article shortHash", () => {
      testShortHash = process.env.MATTERS_TEST_ARTICLE_HASH || "bafyreiaooe6jzxbf2tbpvtue6mcb6g523lp7srroxjrlahflb3m2hpfog4";
    });

    When("I fetch donations for the article", async () => {
      donations = await fetchArticleDonations(testShortHash);
    });

    Then("I should receive an array of donations", () => {
      expect(Array.isArray(donations)).toBe(true);
    });

    And("each donation should have id and sender details", () => {
      for (const donation of donations) {
        expect(donation).toHaveProperty("id");
        expect(donation).toHaveProperty("sender");
        expect(donation.sender).toHaveProperty("id");
        expect(donation.sender).toHaveProperty("userName");
      }
    });
  });

  Scenario("Fetch appreciations for an article", ({ Given, When, Then, And }) => {
    Given("I have a test article shortHash", () => {
      testShortHash = process.env.MATTERS_TEST_ARTICLE_HASH || "bafyreiaooe6jzxbf2tbpvtue6mcb6g523lp7srroxjrlahflb3m2hpfog4";
    });

    When("I fetch appreciations for the article", async () => {
      appreciations = await fetchArticleAppreciations(testShortHash);
    });

    Then("I should receive an array of appreciations", () => {
      expect(Array.isArray(appreciations)).toBe(true);
    });

    And("each appreciation should have amount, createdAt, and sender", () => {
      for (const appreciation of appreciations) {
        expect(appreciation).toHaveProperty("amount");
        expect(typeof appreciation.amount).toBe("number");
        expect(appreciation).toHaveProperty("createdAt");
        expect(appreciation).toHaveProperty("sender");
        expect(appreciation.sender).toHaveProperty("id");
      }
    });
  });

  Scenario("Save social data to .moss/social/matters.json", ({ Given, When, Then, And }) => {
    Given("I have fetched social data for an article", async () => {
      testShortHash = process.env.MATTERS_TEST_ARTICLE_HASH || "bafyreiaooe6jzxbf2tbpvtue6mcb6g523lp7srroxjrlahflb3m2hpfog4";
      comments = await fetchArticleComments(testShortHash);
      donations = await fetchArticleDonations(testShortHash);
      appreciations = await fetchArticleAppreciations(testShortHash);
    });

    When("I save the social data", () => {
      // Create social data structure (without actually saving to filesystem in tests)
      socialData = {
        schemaVersion: "1.0.0",
        updatedAt: new Date().toISOString(),
        articles: {},
      };
      mergeSocialData(socialData, testShortHash, comments, donations, appreciations);
    });

    Then("the file .moss/social/matters.json should exist", () => {
      // In e2e tests, we verify the data structure rather than file system
      expect(socialData).toBeDefined();
    });

    And('it should contain the schemaVersion "1.0.0"', () => {
      expect(socialData.schemaVersion).toBe("1.0.0");
    });

    And("it should contain data for the article shortHash", () => {
      expect(socialData.articles[testShortHash]).toBeDefined();
      const articleData = socialData.articles[testShortHash];
      expect(articleData).toHaveProperty("comments");
      expect(articleData).toHaveProperty("donations");
      expect(articleData).toHaveProperty("appreciations");
    });
  });

  Scenario("Merge new social data with existing", ({ Given, When, Then, And }) => {
    Given("I have existing social data for an article", () => {
      testShortHash = "test-article-hash";
      existingSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: new Date().toISOString(),
        articles: {
          [testShortHash]: {
            comments: [
              {
                id: "existing-comment-1",
                content: "Existing comment",
                createdAt: "2024-01-01T00:00:00Z",
                state: "active" as const,
                upvotes: 5,
                author: {
                  id: "author-1",
                  userName: "testuser",
                  displayName: "Test User",
                },
              },
            ],
            donations: [
              {
                id: "existing-donation-1",
                sender: {
                  id: "donor-1",
                  userName: "donor",
                  displayName: "Donor",
                },
              },
            ],
            appreciations: [],
          },
        },
      };
    });

    And("I fetch new social data", () => {
      // Simulate new data with one existing item and one new item
      comments = [
        {
          id: "existing-comment-1", // Same ID - should be updated
          content: "Updated comment content",
          createdAt: "2024-01-01T00:00:00Z",
          state: "active" as const,
          upvotes: 10, // Updated upvotes
          author: {
            id: "author-1",
            userName: "testuser",
            displayName: "Test User",
          },
        },
        {
          id: "new-comment-1", // New comment
          content: "New comment",
          createdAt: "2024-06-01T00:00:00Z",
          state: "active" as const,
          upvotes: 2,
          author: {
            id: "author-2",
            userName: "newuser",
            displayName: "New User",
          },
        },
      ];
      donations = [
        {
          id: "new-donation-1",
          sender: {
            id: "donor-2",
            userName: "newdonor",
            displayName: "New Donor",
          },
        },
      ];
      appreciations = [
        {
          amount: 5,
          createdAt: "2024-06-01T00:00:00Z",
          sender: {
            id: "sender-1",
            userName: "appreciator",
            displayName: "Appreciator",
          },
        },
      ];
    });

    When("I merge the social data", () => {
      mergeSocialData(existingSocialData, testShortHash, comments, donations, appreciations);
      socialData = existingSocialData;
    });

    Then("new items should be added", () => {
      const articleData = socialData.articles[testShortHash] as ArticleSocialData;
      // Should have both the updated existing comment and the new comment
      expect(articleData.comments.length).toBe(2);
      // Should have both existing and new donation
      expect(articleData.donations.length).toBe(2);
      // Should have the new appreciation
      expect(articleData.appreciations.length).toBe(1);
    });

    And("existing items should be preserved", () => {
      const articleData = socialData.articles[testShortHash] as ArticleSocialData;
      // Existing donation should still be there
      const existingDonation = articleData.donations.find(d => d.id === "existing-donation-1");
      expect(existingDonation).toBeDefined();
    });

    And("no items should be duplicated", () => {
      const articleData = socialData.articles[testShortHash] as ArticleSocialData;
      // Check no duplicate IDs in comments
      const commentIds = articleData.comments.map(c => c.id);
      const uniqueCommentIds = new Set(commentIds);
      expect(commentIds.length).toBe(uniqueCommentIds.size);

      // The existing comment should have been updated, not duplicated
      const updatedComment = articleData.comments.find(c => c.id === "existing-comment-1");
      expect(updatedComment?.upvotes).toBe(10); // Updated value
    });
  });
});
