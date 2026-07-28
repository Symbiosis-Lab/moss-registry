import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GRAPHQL_ENDPOINT,
  ARTICLES_QUERY,
  DRAFTS_QUERY,
  COLLECTIONS_QUERY,
  PROFILE_QUERY,
  ARTICLE_COMMENTS_QUERY,
  ARTICLE_DONATIONS_QUERY,
  ARTICLE_APPRECIATIONS_QUERY,
  PUT_DRAFT_MUTATION,
  PUT_COLLECTION_MUTATION,
  USER_ARTICLES_QUERY,
  USER_COLLECTIONS_QUERY,
  USER_PROFILE_QUERY,
  apiConfig,
  fetchAllDraftsSince,
  fetchArticleComments,
  fetchAllArticleCommentCounts,
  VIEWER_ARTICLE_COMMENT_COUNTS_QUERY,
  USER_ARTICLE_COMMENT_COUNTS_QUERY,
} from "../api";
import { clearTokenCache } from "../credential";
import type { MattersDraft } from "../types";

// Mock the SDK's getPluginCookie, httpPost, and plugin storage
vi.mock("@symbiosis-lab/moss-api", async () => {
  const actual = await vi.importActual("@symbiosis-lab/moss-api");
  return {
    ...actual,
    getPluginCookie: vi.fn(),
    httpPost: vi.fn(),
    pluginFileExists: vi.fn(),
    readPluginFile: vi.fn(),
    writePluginFile: vi.fn(),
  };
});

import { httpPost, pluginFileExists, readPluginFile } from "@symbiosis-lab/moss-api";

describe("API Constants", () => {
  it("has correct GraphQL endpoint", () => {
    expect(GRAPHQL_ENDPOINT).toBe("https://server.matters.town/graphql");
  });

  it("ARTICLES_QUERY includes required fields", () => {
    expect(ARTICLES_QUERY).toContain("MePublishedArticles");
    expect(ARTICLES_QUERY).toContain("articles");
    expect(ARTICLES_QUERY).toContain("title");
    expect(ARTICLES_QUERY).toContain("content");
    expect(ARTICLES_QUERY).toContain("shortHash");
    expect(ARTICLES_QUERY).toContain("pageInfo");
  });

  it("DRAFTS_QUERY includes required fields", () => {
    expect(DRAFTS_QUERY).toContain("MeDrafts");
    expect(DRAFTS_QUERY).toContain("drafts");
    expect(DRAFTS_QUERY).toContain("title");
    expect(DRAFTS_QUERY).toContain("content");
  });

  it("COLLECTIONS_QUERY includes required fields", () => {
    expect(COLLECTIONS_QUERY).toContain("MeCollections");
    expect(COLLECTIONS_QUERY).toContain("collections");
    expect(COLLECTIONS_QUERY).toContain("articles");
  });
});

describe("clearTokenCache", () => {
  it("clears the token cache without error", () => {
    expect(() => clearTokenCache()).not.toThrow();
  });
});

// Note: Integration tests for graphqlQuery, fetchAllArticles, etc. would require
// mocking the global fetch and window.__TAURI__ objects. These are better suited
// for integration tests with a proper test harness.

describe("GraphQL Query Structure", () => {
  it("ARTICLES_QUERY requests pagination with 50 items", () => {
    expect(ARTICLES_QUERY).toContain("first: 50");
  });

  it("DRAFTS_QUERY requests pagination with 50 items", () => {
    expect(DRAFTS_QUERY).toContain("first: 50");
  });

  it("COLLECTIONS_QUERY requests pagination with 50 items", () => {
    expect(COLLECTIONS_QUERY).toContain("first: 50");
  });

  it("COLLECTIONS_QUERY requests up to 100 articles per collection", () => {
    expect(COLLECTIONS_QUERY).toContain("first: 100");
  });

  it("ARTICLES_QUERY filters by active state", () => {
    expect(ARTICLES_QUERY).toContain("state: active");
  });
});

describe("Social Data Queries", () => {
  it("ARTICLE_COMMENTS_QUERY includes required fields", () => {
    expect(ARTICLE_COMMENTS_QUERY).toContain("ArticleComments");
    expect(ARTICLE_COMMENTS_QUERY).toContain("comments");
    expect(ARTICLE_COMMENTS_QUERY).toContain("shortHash");
    expect(ARTICLE_COMMENTS_QUERY).toContain("content");
    expect(ARTICLE_COMMENTS_QUERY).toContain("createdAt");
    expect(ARTICLE_COMMENTS_QUERY).toContain("author");
    expect(ARTICLE_COMMENTS_QUERY).toContain("replyTo");
  });

  it("ARTICLE_DONATIONS_QUERY includes required fields", () => {
    expect(ARTICLE_DONATIONS_QUERY).toContain("ArticleDonations");
    expect(ARTICLE_DONATIONS_QUERY).toContain("donations");
    expect(ARTICLE_DONATIONS_QUERY).toContain("shortHash");
    expect(ARTICLE_DONATIONS_QUERY).toContain("sender");
    expect(ARTICLE_DONATIONS_QUERY).toContain("userName");
  });

  it("ARTICLE_APPRECIATIONS_QUERY includes required fields", () => {
    expect(ARTICLE_APPRECIATIONS_QUERY).toContain("ArticleAppreciations");
    expect(ARTICLE_APPRECIATIONS_QUERY).toContain("appreciationsReceived");
    expect(ARTICLE_APPRECIATIONS_QUERY).toContain("shortHash");
    expect(ARTICLE_APPRECIATIONS_QUERY).toContain("amount");
    expect(ARTICLE_APPRECIATIONS_QUERY).toContain("sender");
  });

  it("Social queries use pagination with 50 items", () => {
    expect(ARTICLE_COMMENTS_QUERY).toContain("first: 50");
    expect(ARTICLE_DONATIONS_QUERY).toContain("first: 50");
    expect(ARTICLE_APPRECIATIONS_QUERY).toContain("first: 50");
  });
});

describe("Syndication Mutations", () => {
  it("PUT_DRAFT_MUTATION includes required fields", () => {
    expect(PUT_DRAFT_MUTATION).toContain("PutDraft");
    expect(PUT_DRAFT_MUTATION).toContain("putDraft");
    expect(PUT_DRAFT_MUTATION).toContain("PutDraftInput");
    expect(PUT_DRAFT_MUTATION).toContain("id");
    expect(PUT_DRAFT_MUTATION).toContain("title");
    expect(PUT_DRAFT_MUTATION).toContain("publishState");
    expect(PUT_DRAFT_MUTATION).toContain("article");
  });

  it("PUT_COLLECTION_MUTATION includes required fields", () => {
    expect(PUT_COLLECTION_MUTATION).toContain("PutCollection");
    expect(PUT_COLLECTION_MUTATION).toContain("putCollection");
    expect(PUT_COLLECTION_MUTATION).toContain("PutCollectionInput");
    expect(PUT_COLLECTION_MUTATION).toContain("id");
    expect(PUT_COLLECTION_MUTATION).toContain("title");
  });
});

describe("User Queries (Public)", () => {
  it("USER_ARTICLES_QUERY includes required fields", () => {
    expect(USER_ARTICLES_QUERY).toContain("UserArticles");
    expect(USER_ARTICLES_QUERY).toContain("$userName: String!");
    expect(USER_ARTICLES_QUERY).toContain("articles");
    expect(USER_ARTICLES_QUERY).toContain("shortHash");
    expect(USER_ARTICLES_QUERY).toContain("createdAt");
    expect(USER_ARTICLES_QUERY).toContain("revisedAt");
  });

  it("USER_COLLECTIONS_QUERY includes required fields", () => {
    expect(USER_COLLECTIONS_QUERY).toContain("UserCollections");
    expect(USER_COLLECTIONS_QUERY).toContain("$userName: String!");
    expect(USER_COLLECTIONS_QUERY).toContain("collections");
    expect(USER_COLLECTIONS_QUERY).toContain("articles");
  });

  it("USER_PROFILE_QUERY includes required fields", () => {
    expect(USER_PROFILE_QUERY).toContain("UserProfile");
    expect(USER_PROFILE_QUERY).toContain("$userName: String!");
    expect(USER_PROFILE_QUERY).toContain("displayName");
    expect(USER_PROFILE_QUERY).toContain("avatar");
  });

  it("USER_PROFILE_QUERY does NOT include settings (private field)", () => {
    // settings { language } is a private field that causes authorization errors
    // for unauthenticated public user queries
    expect(USER_PROFILE_QUERY).not.toMatch(/settings\s*\{/);
  });
});

describe("Pinned Works in Profile Queries", () => {
  it("PROFILE_QUERY includes pinnedWorks with inline fragments", () => {
    expect(PROFILE_QUERY).toContain("pinnedWorks");
    expect(PROFILE_QUERY).toContain("... on Article");
    expect(PROFILE_QUERY).toContain("slug");
    expect(PROFILE_QUERY).toContain("shortHash");
  });

  it("USER_PROFILE_QUERY includes pinnedWorks with inline fragments", () => {
    expect(USER_PROFILE_QUERY).toContain("pinnedWorks");
    expect(USER_PROFILE_QUERY).toContain("... on Article");
    expect(USER_PROFILE_QUERY).toContain("slug");
    expect(USER_PROFILE_QUERY).toContain("shortHash");
  });
});

describe("API Configuration", () => {
  it("has default endpoint for production", () => {
    expect(apiConfig.endpoint).toBe("https://server.matters.town/graphql");
  });

  it("has default queryMode as viewer", () => {
    expect(apiConfig.queryMode).toBe("viewer");
  });

  it("has default testUserName", () => {
    expect(apiConfig.testUserName).toBeDefined();
  });

  it("allows endpoint to be changed", () => {
    const originalEndpoint = apiConfig.endpoint;
    apiConfig.endpoint = "https://server.matters.icu/graphql";
    expect(apiConfig.endpoint).toBe("https://server.matters.icu/graphql");
    apiConfig.endpoint = originalEndpoint; // Reset
  });

  it("allows queryMode to be changed", () => {
    const originalMode = apiConfig.queryMode;
    apiConfig.queryMode = "user";
    expect(apiConfig.queryMode).toBe("user");
    apiConfig.queryMode = originalMode; // Reset
  });
});

describe("fetchAllDraftsSince", () => {
  const mockPluginFileExists = vi.mocked(pluginFileExists);
  const mockReadPluginFile = vi.mocked(readPluginFile);
  const mockHttpPost = vi.mocked(httpPost);

  // Sample drafts with different creation dates
  const sampleDrafts: MattersDraft[] = [
    {
      id: "draft-1",
      title: "Old Draft",
      content: "<p>Old content</p>",
      createdAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "draft-2",
      title: "Mid Draft",
      content: "<p>Mid content</p>",
      summary: "A mid-period draft",
      createdAt: "2024-06-15T12:00:00Z",
      tags: ["test"],
    },
    {
      id: "draft-3",
      title: "Recent Draft",
      content: "<p>Recent content</p>",
      createdAt: "2025-01-10T08:30:00Z",
      cover: "https://example.com/cover.jpg",
    },
  ];

  /**
   * Helper: build a mock httpPost response that returns a single page of drafts.
   * Mimics the GraphQL response shape for ViewerDraftsResponse.
   */
  function mockDraftsResponse(drafts: MattersDraft[]) {
    const responseBody = JSON.stringify({
      data: {
        viewer: {
          id: "viewer-1",
          drafts: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: drafts.map((d) => ({ node: d })),
          },
        },
      },
    });
    return {
      status: 200,
      ok: true,
      contentType: "application/json",
      body: new Uint8Array(),
      text: () => responseBody,
    };
  }

  beforeEach(() => {
    clearTokenCache();
    mockPluginFileExists.mockReset();
    mockReadPluginFile.mockReset();
    mockHttpPost.mockReset();

    // Default: authenticated via stored token
    mockPluginFileExists.mockResolvedValue(true);
    mockReadPluginFile.mockResolvedValue(JSON.stringify({ accessToken: "test-token" }));

    // Default: return all sample drafts
    mockHttpPost.mockResolvedValue(mockDraftsResponse(sampleDrafts));
  });

  it("returns all drafts when no since parameter is provided", async () => {
    const result = await fetchAllDraftsSince();

    expect(result).toHaveLength(3);
    expect(result.map((d) => d.id)).toEqual(["draft-1", "draft-2", "draft-3"]);
  });

  it("filters drafts by createdAt > since when since is provided", async () => {
    // since is between draft-1 (2024-01-01) and draft-2 (2024-06-15)
    const result = await fetchAllDraftsSince("2024-03-01T00:00:00Z");

    // draft-2 and draft-3 are after the since date
    expect(result).toHaveLength(2);
    const ids = result.map((d) => d.id);
    expect(ids).toContain("draft-2");
    expect(ids).toContain("draft-3");
    expect(ids).not.toContain("draft-1");
  });

  it("returns empty array when all drafts are before since", async () => {
    // since is in the future, so no drafts should match
    const result = await fetchAllDraftsSince("2026-01-01T00:00:00Z");

    expect(result).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it("excludes draft with exact createdAt === since (strict >)", async () => {
    // Use the exact createdAt of draft-2 as the since timestamp
    const result = await fetchAllDraftsSince("2024-06-15T12:00:00Z");

    // draft-2 has createdAt exactly equal to since, so it must be excluded
    const ids = result.map((d) => d.id);
    expect(ids).not.toContain("draft-2");

    // Only draft-3 is strictly after
    expect(result).toHaveLength(1);
    expect(ids).toContain("draft-3");
  });
});

describe("fetchArticleComments", () => {
  const mockHttpPost = vi.mocked(httpPost);

  function makeCommentNode(id: string, content: string) {
    return {
      id,
      content,
      createdAt: "2024-06-01T00:00:00Z",
      state: "active",
      upvotes: 0,
      author: { id: "a1", userName: "user1", displayName: "User 1", avatar: null },
      replyTo: null,
    };
  }

  function mockCommentsResponse(
    comments: ReturnType<typeof makeCommentNode>[],
    hasNextPage: boolean,
    endCursor: string | null = null
  ) {
    const responseBody = JSON.stringify({
      data: {
        article: {
          id: "article-1",
          shortHash: "abc123",
          comments: {
            totalCount: comments.length,
            pageInfo: { endCursor, hasNextPage },
            edges: comments.map((c) => ({ node: c })),
          },
        },
      },
    });
    return {
      status: 200,
      ok: true,
      contentType: "application/json",
      body: new Uint8Array(),
      text: () => responseBody,
    };
  }

  beforeEach(() => {
    clearTokenCache();
    mockHttpPost.mockReset();
  });

  it("stops pagination early when all comments on a page are already known", async () => {
    // Page 1: two comments that are already known, with hasNextPage=true
    const page1Comments = [makeCommentNode("c1", "Comment 1"), makeCommentNode("c2", "Comment 2")];
    mockHttpPost.mockResolvedValueOnce(mockCommentsResponse(page1Comments, true, "cursor1"));

    // Page 2 should NOT be fetched
    const page2Comments = [makeCommentNode("c3", "Comment 3")];
    mockHttpPost.mockResolvedValueOnce(mockCommentsResponse(page2Comments, false));

    const knownIds = new Set(["c1", "c2"]);
    const result = await fetchArticleComments("abc123", knownIds);

    // Should return the known comments from page 1 but NOT fetch page 2
    expect(result).toHaveLength(2);
    expect(mockHttpPost).toHaveBeenCalledTimes(1);
  });

  it("fetches all pages when no knownIds provided", async () => {
    const page1Comments = [makeCommentNode("c1", "Comment 1")];
    mockHttpPost.mockResolvedValueOnce(mockCommentsResponse(page1Comments, true, "cursor1"));

    const page2Comments = [makeCommentNode("c2", "Comment 2")];
    mockHttpPost.mockResolvedValueOnce(mockCommentsResponse(page2Comments, false));

    const result = await fetchArticleComments("abc123");

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("c1");
    expect(result[1].id).toBe("c2");
    expect(mockHttpPost).toHaveBeenCalledTimes(2);
  });

  it("fetches next page when some comments on current page are new", async () => {
    // Page 1: c1 is known, c2 is new — should continue to page 2
    const page1Comments = [makeCommentNode("c1", "Comment 1"), makeCommentNode("c2", "Comment 2")];
    mockHttpPost.mockResolvedValueOnce(mockCommentsResponse(page1Comments, true, "cursor1"));

    const page2Comments = [makeCommentNode("c3", "Comment 3")];
    mockHttpPost.mockResolvedValueOnce(mockCommentsResponse(page2Comments, false));

    const knownIds = new Set(["c1"]); // only c1 is known
    const result = await fetchArticleComments("abc123", knownIds);

    expect(result).toHaveLength(3);
    expect(mockHttpPost).toHaveBeenCalledTimes(2);
  });

  describe("sinceTimestamp filtering", () => {
    function makeCommentNodeWithDate(id: string, content: string, createdAt: string) {
      return {
        id,
        content,
        createdAt,
        state: "active",
        upvotes: 0,
        author: { id: "a1", userName: "user1", displayName: "User 1", avatar: null },
        replyTo: null,
      };
    }

    it("filters out comments older than sinceTimestamp", async () => {
      const comments = [
        makeCommentNodeWithDate("c1", "New comment", "2025-03-01T00:00:00Z"),
        makeCommentNodeWithDate("c2", "Old comment", "2025-01-01T00:00:00Z"),
      ];
      mockHttpPost.mockResolvedValueOnce(mockCommentsResponse(comments, false));

      const result = await fetchArticleComments("abc123", undefined, "2025-02-01T00:00:00Z");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("c1");
    });

    it("returns all comments when sinceTimestamp is undefined", async () => {
      const comments = [
        makeCommentNodeWithDate("c1", "New comment", "2025-03-01T00:00:00Z"),
        makeCommentNodeWithDate("c2", "Old comment", "2025-01-01T00:00:00Z"),
      ];
      mockHttpPost.mockResolvedValueOnce(mockCommentsResponse(comments, false));

      const result = await fetchArticleComments("abc123", undefined, undefined);

      expect(result).toHaveLength(2);
    });

    it("stops pagination when oldest comment on page is before sinceTimestamp", async () => {
      // Page 1: newest-first, last comment is older than sinceTimestamp
      const page1Comments = [
        makeCommentNodeWithDate("c1", "New", "2025-03-15T00:00:00Z"),
        makeCommentNodeWithDate("c2", "Old", "2025-01-15T00:00:00Z"),
      ];
      mockHttpPost.mockResolvedValueOnce(mockCommentsResponse(page1Comments, true, "cursor1"));

      // Page 2 should NOT be fetched
      const page2Comments = [
        makeCommentNodeWithDate("c3", "Very old", "2024-06-01T00:00:00Z"),
      ];
      mockHttpPost.mockResolvedValueOnce(mockCommentsResponse(page2Comments, false));

      const result = await fetchArticleComments("abc123", undefined, "2025-02-01T00:00:00Z");

      // Only c1 (after sinceTimestamp) should be returned, c2 filtered out
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("c1");
      // Should NOT have fetched page 2
      expect(mockHttpPost).toHaveBeenCalledTimes(1);
    });

    it("excludes comments with createdAt exactly equal to sinceTimestamp", async () => {
      const comments = [
        makeCommentNodeWithDate("c1", "Exact match", "2025-02-01T00:00:00Z"),
        makeCommentNodeWithDate("c2", "Newer", "2025-03-01T00:00:00Z"),
      ];
      mockHttpPost.mockResolvedValueOnce(mockCommentsResponse(comments, false));

      const result = await fetchArticleComments("abc123", undefined, "2025-02-01T00:00:00Z");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("c2");
    });
  });
});

describe("Comment-count discovery queries", () => {
  it("VIEWER_ARTICLE_COMMENT_COUNTS_QUERY selects shortHash + commentCount only", () => {
    expect(VIEWER_ARTICLE_COMMENT_COUNTS_QUERY).toContain("ViewerArticleCommentCounts");
    expect(VIEWER_ARTICLE_COMMENT_COUNTS_QUERY).toContain("viewer");
    expect(VIEWER_ARTICLE_COMMENT_COUNTS_QUERY).toContain("shortHash");
    expect(VIEWER_ARTICLE_COMMENT_COUNTS_QUERY).toContain("commentCount");
    // Lightweight: must not pull title/content/etc.
    expect(VIEWER_ARTICLE_COMMENT_COUNTS_QUERY).not.toContain("title");
    expect(VIEWER_ARTICLE_COMMENT_COUNTS_QUERY).not.toContain("content");
  });

  it("USER_ARTICLE_COMMENT_COUNTS_QUERY mirrors viewer query for public access", () => {
    expect(USER_ARTICLE_COMMENT_COUNTS_QUERY).toContain("UserArticleCommentCounts");
    expect(USER_ARTICLE_COMMENT_COUNTS_QUERY).toContain("user(input:");
    expect(USER_ARTICLE_COMMENT_COUNTS_QUERY).toContain("shortHash");
    expect(USER_ARTICLE_COMMENT_COUNTS_QUERY).toContain("commentCount");
    expect(USER_ARTICLE_COMMENT_COUNTS_QUERY).not.toContain("title");
  });
});

describe("fetchAllArticleCommentCounts", () => {
  const mockHttpPost = vi.mocked(httpPost);

  function makeViewerPage(
    nodes: Array<{ shortHash: string; commentCount: number }>,
    hasNextPage: boolean,
    endCursor: string | null = null
  ) {
    return {
      status: 200,
      ok: true,
      contentType: "application/json",
      body: new Uint8Array(),
      text: () => JSON.stringify({
        data: {
          viewer: {
            id: "viewer-1",
            articles: {
              pageInfo: { endCursor, hasNextPage },
              edges: nodes.map((node) => ({ node })),
            },
          },
        },
      }),
    };
  }

  function makeUserPage(
    nodes: Array<{ shortHash: string; commentCount: number }>,
    hasNextPage: boolean,
    endCursor: string | null = null
  ) {
    return {
      status: 200,
      ok: true,
      contentType: "application/json",
      body: new Uint8Array(),
      text: () => JSON.stringify({
        data: {
          user: {
            id: "user-1",
            articles: {
              pageInfo: { endCursor, hasNextPage },
              edges: nodes.map((node) => ({ node })),
            },
          },
        },
      }),
    };
  }

  beforeEach(() => {
    clearTokenCache();
    mockHttpPost.mockReset();
  });

  it("returns a map of shortHash → commentCount in viewer mode", async () => {
    const originalMode = apiConfig.queryMode;
    apiConfig.queryMode = "viewer";
    try {
      mockHttpPost.mockResolvedValueOnce(
        makeViewerPage(
          [
            { shortHash: "abc123", commentCount: 4 },
            { shortHash: "def456", commentCount: 0 },
          ],
          false
        )
      );

      const counts = await fetchAllArticleCommentCounts();

      expect(counts.size).toBe(2);
      expect(counts.get("abc123")).toBe(4);
      expect(counts.get("def456")).toBe(0);
      expect(mockHttpPost).toHaveBeenCalledTimes(1);
    } finally {
      apiConfig.queryMode = originalMode;
    }
  });

  it("paginates through multiple pages until hasNextPage=false", async () => {
    const originalMode = apiConfig.queryMode;
    apiConfig.queryMode = "viewer";
    try {
      mockHttpPost.mockResolvedValueOnce(
        makeViewerPage([{ shortHash: "p1a", commentCount: 1 }], true, "cursor1")
      );
      mockHttpPost.mockResolvedValueOnce(
        makeViewerPage([{ shortHash: "p2a", commentCount: 2 }], true, "cursor2")
      );
      mockHttpPost.mockResolvedValueOnce(
        makeViewerPage([{ shortHash: "p3a", commentCount: 3 }], false)
      );

      const counts = await fetchAllArticleCommentCounts();

      expect(counts.size).toBe(3);
      expect(counts.get("p1a")).toBe(1);
      expect(counts.get("p2a")).toBe(2);
      expect(counts.get("p3a")).toBe(3);
      expect(mockHttpPost).toHaveBeenCalledTimes(3);
    } finally {
      apiConfig.queryMode = originalMode;
    }
  });

  it("uses USER query in user mode", async () => {
    const originalMode = apiConfig.queryMode;
    const originalUser = apiConfig.testUserName;
    apiConfig.queryMode = "user";
    apiConfig.testUserName = "Matty";
    try {
      mockHttpPost.mockResolvedValueOnce(
        makeUserPage([{ shortHash: "xyz", commentCount: 7 }], false)
      );

      const counts = await fetchAllArticleCommentCounts();

      expect(counts.get("xyz")).toBe(7);
      // User mode should not require an x-access-token header
      const callArgs = mockHttpPost.mock.calls[0];
      expect(callArgs[2]?.headers ?? {}).not.toHaveProperty("x-access-token");
    } finally {
      apiConfig.queryMode = originalMode;
      apiConfig.testUserName = originalUser;
    }
  });

  it("returns empty map when user is not found in user mode", async () => {
    const originalMode = apiConfig.queryMode;
    apiConfig.queryMode = "user";
    try {
      mockHttpPost.mockResolvedValueOnce({
        status: 200,
        ok: true,
        contentType: "application/json",
        body: new Uint8Array(),
        text: () => JSON.stringify({ data: { user: null } }),
      });

      const counts = await fetchAllArticleCommentCounts();

      expect(counts.size).toBe(0);
    } finally {
      apiConfig.queryMode = originalMode;
    }
  });
});
