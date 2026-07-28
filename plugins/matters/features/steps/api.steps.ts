import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import {
  apiConfig,
  graphqlQueryPublic,
  USER_ARTICLES_QUERY,
  USER_COLLECTIONS_QUERY,
} from "../../src/api";
import type {
  UserArticlesQuery,
  UserCollectionsQuery,
  UserProfileQuery,
} from "../../src/__generated__/types";

const feature = await loadFeature("features/api/fetch-articles.feature");

describeFeature(feature, ({ Scenario }) => {
  // Test state
  let articlesResult: UserArticlesQuery | null = null;
  let profileResult: UserProfileQuery | null = null;
  let collectionsResult: UserCollectionsQuery | null = null;
  let allArticles: NonNullable<NonNullable<UserArticlesQuery["user"]>["articles"]["edges"]> = [];
  let queryError: Error | null = null;

  Scenario("Fetch public user articles", ({ Given, When, Then, And }) => {
    Given("the matters.icu test environment", () => {
      apiConfig.endpoint = "https://server.matters.icu/graphql";
      apiConfig.queryMode = "user";
    });

    When("I query articles for user {string}", async (_ctx, userName: string) => {
      try {
        articlesResult = await graphqlQueryPublic<UserArticlesQuery>(
          USER_ARTICLES_QUERY,
          { userName }
        );
        queryError = null;
      } catch (error) {
        queryError = error as Error;
        articlesResult = null;
      }
    });

    Then("I should receive a list of articles", () => {
      expect(articlesResult).not.toBeNull();
      expect(articlesResult?.user).not.toBeNull();
      expect(articlesResult?.user?.articles.edges).toBeDefined();
      expect(articlesResult?.user?.articles.edges?.length).toBeGreaterThan(0);
    });

    And("each article should have id, title, shortHash, and content", () => {
      const edges = articlesResult?.user?.articles.edges ?? [];
      for (const edge of edges) {
        expect(edge.node.id).toBeDefined();
        expect(edge.node.title).toBeDefined();
        expect(edge.node.shortHash).toBeDefined();
        expect(edge.node.content).toBeDefined();
      }
    });
  });

  Scenario("Handle pagination for users with many articles", ({ Given, When, Then, And }) => {
    Given("the matters.icu test environment", () => {
      apiConfig.endpoint = "https://server.matters.icu/graphql";
      apiConfig.queryMode = "user";
    });

    When("I fetch all articles for user {string} with pagination", async (_ctx, userName: string) => {
      allArticles = [];
      let cursor: string | undefined;

      do {
        const data = await graphqlQueryPublic<UserArticlesQuery>(
          USER_ARTICLES_QUERY,
          { userName, after: cursor }
        );

        if (!data.user) break;

        const edges = data.user.articles.edges ?? [];
        allArticles.push(...edges);

        cursor = data.user.articles.pageInfo.hasNextPage
          ? (data.user.articles.pageInfo.endCursor ?? undefined)
          : undefined;
      } while (cursor);
    });

    Then("I should receive all articles across multiple pages", () => {
      expect(allArticles.length).toBeGreaterThan(0);
    });

    And("all articles should have unique shortHashes", () => {
      const shortHashes = allArticles.map((e) => e.node.shortHash);
      const uniqueHashes = new Set(shortHashes);
      expect(uniqueHashes.size).toBe(shortHashes.length);
    });
  });

  Scenario("Fetch user profile", ({ Given, When, Then }) => {
    Given("the matters.icu test environment", () => {
      apiConfig.endpoint = "https://server.matters.icu/graphql";
      apiConfig.queryMode = "user";
    });

    // Use inline query without settings field (settings is private and requires auth)
    When("I query profile for user {string}", async (_ctx, userName: string) => {
      const PUBLIC_PROFILE_QUERY = `
        query UserProfile($userName: String!) {
          user(input: { userName: $userName }) {
            id
            userName
            displayName
            info {
              description
              profileCover
            }
            avatar
          }
        }
      `;
      profileResult = await graphqlQueryPublic<UserProfileQuery>(
        PUBLIC_PROFILE_QUERY,
        { userName }
      );
    });

    Then("I should receive profile with userName and displayName", () => {
      expect(profileResult?.user).not.toBeNull();
      expect(profileResult?.user?.userName).toBeDefined();
      expect(profileResult?.user?.displayName).toBeDefined();
    });
  });

  Scenario("Fetch user collections", ({ Given, When, Then }) => {
    Given("the matters.icu test environment", () => {
      apiConfig.endpoint = "https://server.matters.icu/graphql";
      apiConfig.queryMode = "user";
    });

    When("I query collections for user {string}", async (_ctx, userName: string) => {
      collectionsResult = await graphqlQueryPublic<UserCollectionsQuery>(
        USER_COLLECTIONS_QUERY,
        { userName }
      );
    });

    Then("I should receive a list of collections or empty list", () => {
      // User might have no collections, which is valid
      expect(collectionsResult?.user).not.toBeNull();
      expect(collectionsResult?.user?.collections).toBeDefined();
      // edges can be empty array or array with items - both are valid
      expect(Array.isArray(collectionsResult?.user?.collections.edges)).toBe(true);
    });
  });

  Scenario("Handle non-existent user gracefully", ({ Given, When, Then }) => {
    Given("the matters.icu test environment", () => {
      apiConfig.endpoint = "https://server.matters.icu/graphql";
      apiConfig.queryMode = "user";
    });

    When("I query articles for user {string}", async (_ctx, userName: string) => {
      try {
        articlesResult = await graphqlQueryPublic<UserArticlesQuery>(
          USER_ARTICLES_QUERY,
          { userName }
        );
        queryError = null;
      } catch (error) {
        queryError = error as Error;
        articlesResult = null;
      }
    });

    Then("the query should return null user", () => {
      expect(articlesResult?.user).toBeNull();
    });
  });
});
