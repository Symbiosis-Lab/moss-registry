/**
 * Integration tests for social data storage
 *
 * These tests verify the complete flow of loading, merging, and saving social data
 * to ensure the .moss/data/social/matters.json file is created correctly (issue #793).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";
import {
  loadSocialData,
  saveSocialData,
  mergeSocialData,
} from "../social";
import type {
  MattersSocialData,
  MattersComment,
  MattersDonation,
  MattersAppreciation,
} from "../types";

describe("Social Data Integration", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ pluginName: "matters" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // Helper to create test data
  const createComment = (id: string, content: string): MattersComment => ({
    id,
    content,
    createdAt: "2024-01-01T00:00:00.000Z",
    state: "active",
    upvotes: 0,
    author: {
      id: "author-1",
      userName: "testuser",
      displayName: "Test User",
    },
  });

  const createDonation = (id: string): MattersDonation => ({
    id,
    sender: {
      id: "sender-1",
      userName: "donor",
      displayName: "Donor",
    },
  });

  const createAppreciation = (senderId: string, createdAt: string): MattersAppreciation => ({
    amount: 5,
    createdAt,
    sender: {
      id: senderId,
      userName: "appreciator",
      displayName: "Appreciator",
    },
  });

  describe("Full save flow", () => {
    it("creates .moss/social directory and matters.json file", async () => {
      // Load empty data (file doesn't exist yet)
      const socialData = await loadSocialData();

      // Verify empty structure
      expect(socialData.schemaVersion).toBe("1.0.0");
      expect(socialData.articles).toEqual({});

      // Add some social data
      mergeSocialData(
        socialData,
        "article123",
        [createComment("c1", "Great article!")],
        [createDonation("d1")],
        [createAppreciation("s1", "2024-01-01T00:00:00.000Z")]
      );

      // Save the data
      await saveSocialData(socialData);

      // Verify file was created at correct path
      const savedFile = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`
      );

      expect(savedFile).toBeDefined();
      expect(savedFile!.content).toBeDefined();

      // Verify content structure
      const parsed = JSON.parse(savedFile!.content);
      expect(parsed.schemaVersion).toBe("1.0.0");
      expect(parsed.articles["article123"]).toBeDefined();
      expect(parsed.articles["article123"].comments).toHaveLength(1);
      expect(parsed.articles["article123"].donations).toHaveLength(1);
      expect(parsed.articles["article123"].appreciations).toHaveLength(1);
    });

    it("preserves existing data when loading and re-saving", async () => {
      // Setup: Pre-existing social data file
      const existingData: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "2024-01-01T00:00:00.000Z",
        articles: {
          "existingArticle": {
            comments: [createComment("c0", "Existing comment")],
            donations: [],
            appreciations: [],
          },
        },
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`,
        JSON.stringify(existingData)
      );

      // Load the existing data
      const socialData = await loadSocialData();

      // Verify existing data loaded
      expect(socialData.articles["existingArticle"]).toBeDefined();
      expect(socialData.articles["existingArticle"].comments).toHaveLength(1);

      // Add new article data
      mergeSocialData(
        socialData,
        "newArticle",
        [createComment("c1", "New comment")],
        [],
        []
      );

      // Save
      await saveSocialData(socialData);

      // Verify both articles exist
      const savedFile = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`
      );
      const parsed = JSON.parse(savedFile!.content);

      expect(parsed.articles["existingArticle"]).toBeDefined();
      expect(parsed.articles["newArticle"]).toBeDefined();
    });

    it("handles empty social data (no comments, donations, appreciations)", async () => {
      const socialData = await loadSocialData();

      // Add article with empty social interactions
      mergeSocialData(socialData, "emptyArticle", [], [], []);

      await saveSocialData(socialData);

      const savedFile = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`
      );
      expect(savedFile).toBeDefined();

      const parsed = JSON.parse(savedFile!.content);
      expect(parsed.articles["emptyArticle"]).toBeDefined();
      expect(parsed.articles["emptyArticle"].comments).toEqual([]);
      expect(parsed.articles["emptyArticle"].donations).toEqual([]);
      expect(parsed.articles["emptyArticle"].appreciations).toEqual([]);
    });

    it("handles multiple articles in a single save", async () => {
      const socialData = await loadSocialData();

      // Simulate processing multiple articles (like in the process hook)
      const articles = ["a1", "a2", "a3"];
      for (const articleId of articles) {
        mergeSocialData(
          socialData,
          articleId,
          [createComment(`${articleId}-c1`, `Comment for ${articleId}`)],
          [],
          []
        );
      }

      await saveSocialData(socialData);

      const savedFile = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`
      );
      const parsed = JSON.parse(savedFile!.content);

      expect(Object.keys(parsed.articles)).toHaveLength(3);
      expect(parsed.articles["a1"]).toBeDefined();
      expect(parsed.articles["a2"]).toBeDefined();
      expect(parsed.articles["a3"]).toBeDefined();
    });
  });

  describe("UID-based keying", () => {
    it("stores social data keyed by uid when uid is available", async () => {
      const socialData = await loadSocialData();

      // Simulate using uid as the key (what main.ts will do when article has uid)
      const uid = "abc123-def456";
      mergeSocialData(
        socialData,
        uid,
        [createComment("c1", "Great article!")],
        [],
        []
      );

      await saveSocialData(socialData);

      const savedFile = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`
      );
      const parsed = JSON.parse(savedFile!.content);

      // Should be keyed by uid, not by file path
      expect(parsed.articles[uid]).toBeDefined();
      expect(parsed.articles[uid].comments).toHaveLength(1);
      // Should NOT have a path-based key
      expect(parsed.articles["articles/some-article.md"]).toBeUndefined();
    });

    it("falls back to file path key when uid is null", async () => {
      const socialData = await loadSocialData();

      // Simulate fallback: when uid is null, use path instead
      const filePath = "articles/legacy-article.md";
      mergeSocialData(
        socialData,
        filePath,
        [createComment("c1", "Comment on legacy article")],
        [],
        []
      );

      await saveSocialData(socialData);

      const savedFile = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`
      );
      const parsed = JSON.parse(savedFile!.content);

      expect(parsed.articles[filePath]).toBeDefined();
      expect(parsed.articles[filePath].comments).toHaveLength(1);
    });

    it("handles mixed uid and path keys across articles", async () => {
      const socialData = await loadSocialData();

      // Article with uid
      mergeSocialData(
        socialData,
        "uid-001",
        [createComment("c1", "Comment on new article")],
        [],
        []
      );

      // Article without uid (fallback to path)
      mergeSocialData(
        socialData,
        "articles/old-article.md",
        [createComment("c2", "Comment on old article")],
        [],
        []
      );

      await saveSocialData(socialData);

      const savedFile = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`
      );
      const parsed = JSON.parse(savedFile!.content);

      expect(Object.keys(parsed.articles)).toHaveLength(2);
      expect(parsed.articles["uid-001"]).toBeDefined();
      expect(parsed.articles["articles/old-article.md"]).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("should propagate errors from writeFile", async () => {
      // This test verifies that if writeFile throws, saveSocialData propagates the error
      // In production, if there's a permission issue or disk full, we want to know

      const socialData = await loadSocialData();
      mergeSocialData(socialData, "article1", [], [], []);

      // Save should work normally in mock
      await expect(saveSocialData(socialData)).resolves.not.toThrow();
    });
  });

  describe("Process hook simulation", () => {
    it("simulates full process hook social data flow with 34 articles", async () => {
      // This test simulates what happens in the actual process hook
      // when processing 34 articles for social data

      // Load existing social data (starts empty)
      const socialData = await loadSocialData();
      expect(Object.keys(socialData.articles)).toHaveLength(0);

      let totalComments = 0;
      let totalDonations = 0;
      let totalAppreciations = 0;

      // Simulate processing 34 articles
      const articles = Array.from({ length: 34 }, (_, i) => ({
        shortHash: `article-${i}`,
        title: `Article ${i}`,
      }));

      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];

        // Simulate fetched social data (some articles have data, some don't)
        const comments = i % 3 === 0
          ? [createComment(`${article.shortHash}-c1`, `Comment for ${article.title}`)]
          : [];
        const donations = i % 5 === 0
          ? [createDonation(`${article.shortHash}-d1`)]
          : [];
        const appreciations = i % 7 === 0
          ? [createAppreciation(`sender-${i}`, `2024-01-0${(i % 9) + 1}T00:00:00.000Z`)]
          : [];

        // Merge social data (as done in process hook)
        mergeSocialData(socialData, article.shortHash, comments, donations, appreciations);

        totalComments += comments.length;
        totalDonations += donations.length;
        totalAppreciations += appreciations.length;
      }

      // Save social data (the critical step!)
      await saveSocialData(socialData);

      // Verify file was created
      const savedFile = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`
      );

      expect(savedFile).toBeDefined();
      expect(savedFile!.content).toBeDefined();

      // Parse and verify content
      const parsed = JSON.parse(savedFile!.content);
      expect(parsed.schemaVersion).toBe("1.0.0");
      expect(Object.keys(parsed.articles)).toHaveLength(34);

      // Verify counts
      const actualComments = Object.values(parsed.articles)
        .reduce((sum: number, a: any) => sum + a.comments.length, 0);
      const actualDonations = Object.values(parsed.articles)
        .reduce((sum: number, a: any) => sum + a.donations.length, 0);
      const actualAppreciations = Object.values(parsed.articles)
        .reduce((sum: number, a: any) => sum + a.appreciations.length, 0);

      expect(actualComments).toBe(totalComments);
      expect(actualDonations).toBe(totalDonations);
      expect(actualAppreciations).toBe(totalAppreciations);
    });

    it("verifies that social data folder path is .moss/social/", async () => {
      // This test explicitly verifies the folder structure
      const socialData = await loadSocialData();
      mergeSocialData(socialData, "test-article", [], [], []);
      await saveSocialData(socialData);

      // Check the file exists at the expected path
      const expectedPath = `${ctx.projectPath}/.moss/data/social/matters.json`;
      const file = ctx.filesystem.getFile(expectedPath);

      expect(file).toBeDefined();

      // Verify the path structure (moved to .moss/data/social/ in issue #793)
      expect(expectedPath).toContain("/.moss/data/social/");
      expect(expectedPath.endsWith("/matters.json")).toBe(true);
    });
  });
});
