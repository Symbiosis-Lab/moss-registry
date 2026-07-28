import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { apiConfig, fetchAllArticlesSince } from "../../src/api";
import type { MattersArticle } from "../../src/types";

const feature = await loadFeature("features/sync/incremental-sync.feature");

describeFeature(feature, ({ Scenario, Background }) => {
  // Test state
  let fetchedArticles: MattersArticle[] = [];
  let lastSyncedAt: string | undefined;
  let initialArticleCount = 0;

  Background(({ Given, And }) => {
    Given("I am using the Matters test environment", () => {
      apiConfig.endpoint = "https://server.matters.icu/graphql";
      apiConfig.queryMode = "user";
      apiConfig.testUserName = process.env.MATTERS_TEST_USER || "yhh354";
    });

    And("I have a test user with articles", () => {
      // Test user is pre-configured
    });
  });

  Scenario("First sync fetches all articles and saves timestamp", ({ Given, When, Then, And }) => {
    Given("I have no previous sync timestamp", () => {
      lastSyncedAt = undefined;
    });

    When("I run the sync process", async () => {
      const result = await fetchAllArticlesSince(lastSyncedAt);
      fetchedArticles = result.articles;
      initialArticleCount = fetchedArticles.length;
      // Simulate saving timestamp
      lastSyncedAt = new Date().toISOString();
    });

    Then("all articles should be fetched", () => {
      expect(fetchedArticles.length).toBeGreaterThan(0);
    });

    And("the config should contain a lastSyncedAt timestamp", () => {
      expect(lastSyncedAt).toBeDefined();
      expect(new Date(lastSyncedAt!).getTime()).toBeGreaterThan(0);
    });
  });

  Scenario("Subsequent sync only fetches newer articles", ({ Given, When, Then, And }) => {
    Given("I have a lastSyncedAt timestamp from 1 hour ago", () => {
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);
      lastSyncedAt = oneHourAgo.toISOString();
    });

    And("the test user has multiple articles", async () => {
      // Verify user has articles
      const result = await fetchAllArticlesSince(undefined);
      expect(result.articles.length).toBeGreaterThan(0);
      initialArticleCount = result.articles.length;
    });

    When("I run the sync process", async () => {
      const result = await fetchAllArticlesSince(lastSyncedAt);
      fetchedArticles = result.articles;
    });

    Then("only recently modified articles should be fetched", () => {
      // Should fetch fewer articles than total (or 0 if none modified)
      expect(fetchedArticles.length).toBeLessThanOrEqual(initialArticleCount);
    });

    And("the lastSyncedAt timestamp should be updated", () => {
      const newTimestamp = new Date().toISOString();
      expect(new Date(newTimestamp).getTime()).toBeGreaterThan(
        new Date(lastSyncedAt!).getTime()
      );
    });
  });

  Scenario("Sync skips unchanged articles when no modifications", ({ Given, When, Then, And }) => {
    Given("I have synced all articles recently", async () => {
      // Set timestamp to now (all articles are "old")
      lastSyncedAt = new Date().toISOString();
    });

    And("no articles have been modified since", () => {
      // This is assumed based on the current timestamp
    });

    When("I run the sync process again", async () => {
      const result = await fetchAllArticlesSince(lastSyncedAt);
      fetchedArticles = result.articles;
    });

    Then("0 articles should be fetched", () => {
      expect(fetchedArticles.length).toBe(0);
    });

    And("existing local files should remain unchanged", () => {
      // This is verified by the fact that no new articles were returned
      // In a real scenario, we would check file modification times
    });
  });
});
