import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";
import {
  loadSocialData,
  saveSocialData,
  mergeSocialData,
  getArticleSocialData,
  getSocialCounts,
  reconcileLegacySocialData,
  mergeCommentsDeduped,
} from "../social";
import type {
  MattersSocialData,
  MattersComment,
  MattersDonation,
  MattersAppreciation,
} from "../types";

describe("Social Module", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ pluginName: "matters-syndicator" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("loadSocialData", () => {
    it("returns empty data structure when file does not exist", async () => {
      const data = await loadSocialData();

      expect(data.schemaVersion).toBe("1.0.0");
      expect(data.articles).toEqual({});
      expect(data.updatedAt).toBeDefined();
    });

    it("returns parsed data when file exists", async () => {
      const existingData: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "2024-01-01T00:00:00.000Z",
        articles: {
          "abc123": {
            comments: [],
            donations: [],
            appreciations: [],
          },
        },
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`,
        JSON.stringify(existingData)
      );

      const data = await loadSocialData();

      expect(data.schemaVersion).toBe("1.0.0");
      expect(data.articles["abc123"]).toBeDefined();
    });

    it("returns empty data on invalid JSON", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`,
        "invalid json {{{"
      );

      const data = await loadSocialData();

      expect(data.schemaVersion).toBe("1.0.0");
      expect(data.articles).toEqual({});
    });

    it("returns empty data when schemaVersion is missing", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`,
        JSON.stringify({ articles: {} })
      );

      const data = await loadSocialData();

      expect(data.schemaVersion).toBe("1.0.0");
      expect(data.articles).toEqual({});
    });

    it("returns empty data when articles field is missing", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`,
        JSON.stringify({ schemaVersion: "1.0.0" })
      );

      const data = await loadSocialData();

      expect(data.schemaVersion).toBe("1.0.0");
      expect(data.articles).toEqual({});
    });
  });

  describe("saveSocialData", () => {
    it("saves social data to correct path", async () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "2024-01-01T00:00:00.000Z",
        articles: {
          "abc123": {
            comments: [],
            donations: [],
            appreciations: [],
          },
        },
      };

      await saveSocialData(data);

      const savedContent = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`
      );
      expect(savedContent).toBeDefined();

      const parsed = JSON.parse(savedContent!.content);
      expect(parsed.schemaVersion).toBe("1.0.0");
      expect(parsed.articles["abc123"]).toBeDefined();
    });

    it("updates updatedAt timestamp on save", async () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "2024-01-01T00:00:00.000Z",
        articles: {},
      };

      const beforeSave = new Date().toISOString();
      await saveSocialData(data);

      const savedContent = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`
      );
      const parsed = JSON.parse(savedContent!.content);

      // updatedAt should be after or equal to beforeSave
      expect(new Date(parsed.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeSave).getTime() - 1000 // Allow 1 second tolerance
      );
    });
  });

  describe("mergeSocialData", () => {
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

    it("adds new article data to empty structure", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };

      const comments = [createComment("c1", "Comment 1")];
      const donations = [createDonation("d1")];
      const appreciations = [createAppreciation("s1", "2024-01-01T00:00:00.000Z")];

      mergeSocialData(data, "abc123", comments, donations, appreciations);

      expect(data.articles["abc123"]).toBeDefined();
      expect(data.articles["abc123"].comments).toHaveLength(1);
      expect(data.articles["abc123"].donations).toHaveLength(1);
      expect(data.articles["abc123"].appreciations).toHaveLength(1);
    });

    it("merges new comments without duplicates", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [createComment("c1", "Original")],
            donations: [],
            appreciations: [],
          },
        },
      };

      const newComments = [
        createComment("c1", "Updated"), // Same ID, should update
        createComment("c2", "New"),     // New ID, should add
      ];

      mergeSocialData(data, "abc123", newComments, [], []);

      expect(data.articles["abc123"].comments).toHaveLength(2);
      const c1 = data.articles["abc123"].comments.find(c => c.id === "c1");
      expect(c1?.content).toBe("Updated");
    });

    it("merges new donations without duplicates", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [],
            donations: [createDonation("d1")],
            appreciations: [],
          },
        },
      };

      const newDonations = [
        createDonation("d1"), // Same ID, should update
        createDonation("d2"), // New ID, should add
      ];

      mergeSocialData(data, "abc123", [], newDonations, []);

      expect(data.articles["abc123"].donations).toHaveLength(2);
    });

    it("merges appreciations using sender.id + createdAt as key", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [],
            donations: [],
            appreciations: [createAppreciation("s1", "2024-01-01T00:00:00.000Z")],
          },
        },
      };

      const newAppreciations = [
        createAppreciation("s1", "2024-01-01T00:00:00.000Z"), // Same key, should update
        createAppreciation("s1", "2024-01-02T00:00:00.000Z"), // Same sender, different time
        createAppreciation("s2", "2024-01-01T00:00:00.000Z"), // Different sender
      ];

      mergeSocialData(data, "abc123", [], [], newAppreciations);

      expect(data.articles["abc123"].appreciations).toHaveLength(3);
    });

    it("preserves existing data when merging empty arrays", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [createComment("c1", "Existing")],
            donations: [createDonation("d1")],
            appreciations: [createAppreciation("s1", "2024-01-01T00:00:00.000Z")],
          },
        },
      };

      mergeSocialData(data, "abc123", [], [], []);

      expect(data.articles["abc123"].comments).toHaveLength(1);
      expect(data.articles["abc123"].donations).toHaveLength(1);
      expect(data.articles["abc123"].appreciations).toHaveLength(1);
    });

    it("handles multiple articles independently", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [createComment("c1", "Article 1")],
            donations: [],
            appreciations: [],
          },
        },
      };

      mergeSocialData(data, "xyz789", [createComment("c2", "Article 2")], [], []);

      expect(data.articles["abc123"].comments).toHaveLength(1);
      expect(data.articles["xyz789"].comments).toHaveLength(1);
      expect(data.articles["abc123"].comments[0].content).toBe("Article 1");
      expect(data.articles["xyz789"].comments[0].content).toBe("Article 2");
    });

    it("records lastKnownCommentCount when provided", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };

      mergeSocialData(data, "abc123", [createComment("c1", "Hi")], [], [], 7);

      expect(data.articles["abc123"].lastKnownCommentCount).toBe(7);
    });

    it("preserves prior lastKnownCommentCount when omitted", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [createComment("c1", "Hi")],
            donations: [],
            appreciations: [],
            lastKnownCommentCount: 5,
          },
        },
      };

      // No commentCount passed (e.g., a syndicate-time merge)
      mergeSocialData(data, "abc123", [createComment("c2", "Bye")], [], []);

      expect(data.articles["abc123"].lastKnownCommentCount).toBe(5);
    });

    it("overwrites prior lastKnownCommentCount when a new value is provided", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [],
            donations: [],
            appreciations: [],
            lastKnownCommentCount: 3,
          },
        },
      };

      mergeSocialData(data, "abc123", [createComment("c1", "New")], [], [], 4);

      expect(data.articles["abc123"].lastKnownCommentCount).toBe(4);
    });
  });

  describe("getArticleSocialData", () => {
    it("returns article data when it exists", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [],
            donations: [],
            appreciations: [],
          },
        },
      };

      const result = getArticleSocialData(data, "abc123");

      expect(result).toBeDefined();
      expect(result?.comments).toEqual([]);
    });

    it("returns undefined when article does not exist", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };

      const result = getArticleSocialData(data, "nonexistent");

      expect(result).toBeUndefined();
    });
  });

  describe("getSocialCounts", () => {
    it("returns zero counts for nonexistent article", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };

      const counts = getSocialCounts(data, "nonexistent");

      expect(counts.comments).toBe(0);
      expect(counts.donations).toBe(0);
      expect(counts.appreciations).toBe(0);
      expect(counts.totalClaps).toBe(0);
    });

    it("returns correct counts for existing article", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [
              {
                id: "c1",
                content: "Comment",
                createdAt: "",
                state: "active",
                upvotes: 0,
                author: { id: "a1", userName: "u1", displayName: "U1" },
              },
              {
                id: "c2",
                content: "Comment 2",
                createdAt: "",
                state: "active",
                upvotes: 0,
                author: { id: "a2", userName: "u2", displayName: "U2" },
              },
            ],
            donations: [
              {
                id: "d1",
                sender: { id: "s1", userName: "donor", displayName: "Donor" },
              },
            ],
            appreciations: [
              {
                amount: 5,
                createdAt: "",
                sender: { id: "s1", userName: "ap1", displayName: "AP1" },
              },
              {
                amount: 10,
                createdAt: "",
                sender: { id: "s2", userName: "ap2", displayName: "AP2" },
              },
            ],
          },
        },
      };

      const counts = getSocialCounts(data, "abc123");

      expect(counts.comments).toBe(2);
      expect(counts.donations).toBe(1);
      expect(counts.appreciations).toBe(2);
      expect(counts.totalClaps).toBe(15);
    });
  });

  // ============================================================================
  // reconcileLegacySocialData
  // ============================================================================

  describe("reconcileLegacySocialData", () => {
    const makeComment = (id: string): MattersComment => ({
      id,
      content: `comment ${id}`,
      createdAt: "2024-01-01T00:00:00.000Z",
      state: "active",
      upvotes: 0,
      author: { id: "a1", userName: "user", displayName: "User" },
    });

    it("no-op when legacy file does not exist", async () => {
      const current: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };
      const migrated = await reconcileLegacySocialData(current, new Map());
      expect(migrated).toBe(false);
      // current unchanged
      expect(Object.keys(current.articles)).toHaveLength(0);
    });

    it("no-op when migrated-bak already exists (idempotent)", async () => {
      // Place both legacy and migrated-bak in the mock fs.
      const legacyData: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "2024-01-01T00:00:00.000Z",
        articles: { "uid-abc": { comments: [makeComment("c1")], donations: [], appreciations: [] } },
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/social/matters.json`,
        JSON.stringify(legacyData)
      );
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/social/matters.json.migrated-bak`,
        JSON.stringify(legacyData)
      );

      const current: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };
      const migrated = await reconcileLegacySocialData(current, new Map());
      expect(migrated).toBe(false);
    });

    it("remaps shortHash keys to uid via provided mapping", async () => {
      const shortHash = "abcd1234";
      const uid = "uid-of-article";
      const legacyData: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "2024-01-01T00:00:00.000Z",
        articles: {
          [shortHash]: {
            comments: [makeComment("c1"), makeComment("c2")],
            donations: [],
            appreciations: [],
            lastKnownCommentCount: 2,
          },
        },
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/social/matters.json`,
        JSON.stringify(legacyData)
      );

      const current: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };
      const mapping = new Map([[shortHash, uid]]);
      const migrated = await reconcileLegacySocialData(current, mapping);

      expect(migrated).toBe(true);
      // Entry remapped to uid key
      expect(current.articles[uid]).toBeDefined();
      expect(current.articles[uid].comments).toHaveLength(2);
      // Old shortHash key NOT in current
      expect(current.articles[shortHash]).toBeUndefined();
    });

    it("deduplicates comments by id, prefers richer (more) side", async () => {
      const uid = "uid-123";
      // Current has 1 comment; legacy has 3 (includes the same c1 + 2 new)
      const legacyData: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          [uid]: {
            comments: [makeComment("c1"), makeComment("c2"), makeComment("c3")],
            donations: [],
            appreciations: [],
          },
        },
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/social/matters.json`,
        JSON.stringify(legacyData)
      );

      const current: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          [uid]: {
            comments: [makeComment("c1")],
            donations: [],
            appreciations: [],
          },
        },
      };
      const migrated = await reconcileLegacySocialData(current, new Map());

      expect(migrated).toBe(true);
      const merged = current.articles[uid].comments;
      // All 3 unique comments (c1 deduplicated, c2+c3 added from legacy)
      expect(merged).toHaveLength(3);
      const ids = merged.map(c => c.id);
      expect(ids).toContain("c1");
      expect(ids).toContain("c2");
      expect(ids).toContain("c3");
    });

    it("clears lastKnownCommentCount when stored count exceeds actual comments", async () => {
      const uid = "uid-poisoned";
      // Legacy has storedCount=57 but only 1 comment (poisoned entry)
      const legacyData: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          [uid]: {
            comments: [makeComment("c1")],
            donations: [],
            appreciations: [],
            lastKnownCommentCount: 57,
          },
        },
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/social/matters.json`,
        JSON.stringify(legacyData)
      );

      const current: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };
      await reconcileLegacySocialData(current, new Map());

      // Poisoned count must be cleared so next sync refetches
      expect(current.articles[uid].lastKnownCommentCount).toBeUndefined();
    });

    it("preserves lastKnownCommentCount when consistent with actual comments", async () => {
      const uid = "uid-clean";
      const legacyData: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          [uid]: {
            comments: [makeComment("c1"), makeComment("c2")],
            donations: [],
            appreciations: [],
            lastKnownCommentCount: 2,
          },
        },
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/social/matters.json`,
        JSON.stringify(legacyData)
      );

      const current: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };
      await reconcileLegacySocialData(current, new Map());

      // Count matches actual comments — must be preserved
      expect(current.articles[uid].lastKnownCommentCount).toBe(2);
    });

    it("carries over a legacy entry whose key maps to no known shortHash/uid unchanged", async () => {
      // An entry keyed by an arbitrary string that is NOT in the shortHashToUid
      // mapping (e.g., a very old entry keyed by a path or an unrecognised hash)
      // must be preserved as-is so we don't silently drop historical data.
      const unknownKey = "totally-unknown-key-not-in-mapping";
      const legacyData: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "2024-01-01T00:00:00.000Z",
        articles: {
          [unknownKey]: {
            comments: [makeComment("c1"), makeComment("c2")],
            donations: [],
            appreciations: [],
            lastKnownCommentCount: 2,
          },
        },
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/social/matters.json`,
        JSON.stringify(legacyData)
      );

      const current: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };
      // Empty mapping: the unknown key cannot be remapped.
      const migrated = await reconcileLegacySocialData(current, new Map());

      expect(migrated).toBe(true);
      // The entry must survive under its original key (fallback path: uid ?? legacyKey).
      expect(current.articles[unknownKey]).toBeDefined();
      expect(current.articles[unknownKey].comments).toHaveLength(2);
      expect(current.articles[unknownKey].lastKnownCommentCount).toBe(2);
    });

    it("run-twice idempotence: second run from the file state produced by the first run is a no-op", async () => {
      // Set up: legacy file with one article.
      const uid = "uid-idempotent";
      const legacyData: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "2024-01-01T00:00:00.000Z",
        articles: {
          [uid]: {
            comments: [makeComment("c1")],
            donations: [],
            appreciations: [],
            lastKnownCommentCount: 1,
          },
        },
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/social/matters.json`,
        JSON.stringify(legacyData)
      );

      // First run: performs migration.
      const current1: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };
      const migrated1 = await reconcileLegacySocialData(current1, new Map());
      expect(migrated1).toBe(true);
      expect(current1.articles[uid]).toBeDefined();

      // The migrated-bak file now exists in the mock FS (written by the first run).
      // Re-load canonical state from the mock FS to simulate the next sync startup.
      const canonicalContent = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/data/social/matters.json`
      );
      expect(canonicalContent).toBeDefined();
      const current2: MattersSocialData = JSON.parse(canonicalContent!.content);

      // Second run: the migrated-bak guard fires — must be a no-op.
      const migrated2 = await reconcileLegacySocialData(current2, new Map());
      expect(migrated2).toBe(false);

      // Data unchanged after the second run.
      expect(current2.articles[uid]).toBeDefined();
      expect(current2.articles[uid].comments).toHaveLength(1);
    });
  });

  // ============================================================================
  // mergeCommentsDeduped (unit)
  // ============================================================================

  describe("mergeCommentsDeduped", () => {
    const makeComment = (id: string): MattersComment => ({
      id,
      content: `comment ${id}`,
      createdAt: "2024-01-01T00:00:00.000Z",
      state: "active",
      upvotes: 0,
      author: { id: "a1", userName: "user", displayName: "User" },
    });

    it("returns union of both arrays, deduped by id", () => {
      const current = [makeComment("c1"), makeComment("c2")];
      const legacy = [makeComment("c2"), makeComment("c3")];
      const result = mergeCommentsDeduped(current, legacy);
      expect(result).toHaveLength(3);
      const ids = result.map(c => c.id);
      expect(ids).toContain("c1");
      expect(ids).toContain("c2");
      expect(ids).toContain("c3");
    });

    it("current version of duplicate wins (current iterated first)", () => {
      const current = [{ ...makeComment("c1"), content: "current version" }];
      const legacy = [{ ...makeComment("c1"), content: "legacy version" }];
      const result = mergeCommentsDeduped(current, legacy);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("current version");
    });

    it("handles empty current", () => {
      const legacy = [makeComment("c1"), makeComment("c2")];
      const result = mergeCommentsDeduped([], legacy);
      expect(result).toHaveLength(2);
    });

    it("handles empty legacy", () => {
      const current = [makeComment("c1")];
      const result = mergeCommentsDeduped(current, []);
      expect(result).toHaveLength(1);
    });
  });
});
