/**
 * GraphQL API client and authentication for Matters.town
 *
 * Supports two query modes:
 * - "viewer" (production): Uses authenticated viewer queries
 * - "user" (testing): Uses public user queries (no auth required)
 *
 * Configure via environment variables or apiConfig:
 * - MATTERS_API_ENDPOINT: GraphQL endpoint URL
 * - MATTERS_QUERY_MODE: "viewer" or "user"
 * - MATTERS_TEST_USER: Username for user queries in tests
 */

import type {
  MattersArticle,
  MattersDraft,
  MattersCollection,
  MattersUserProfile,
  MattersComment,
  MattersDonation,
  MattersAppreciation,
  MattersDraftWithArticle,
  ViewerArticlesResponse,
  ViewerDraftsResponse,
  ViewerCollectionsResponse,
  ViewerProfileResponse,
  ArticleCommentsResponse,
  ArticleDonationsResponse,
  ArticleAppreciationsResponse,
  ViewerArticleCommentCountsResponse,
  UserArticleCommentCountsResponse,
  PutDraftInput,
  PutDraftResponse,
  PutCollectionInput,
  PutCollectionResponse,
} from "./types";
import type {
  UserArticlesQuery,
  UserCollectionsQuery,
  UserProfileQuery,
} from "./__generated__/types";
import { httpPost, httpPostMultipart } from "@symbiosis-lab/moss-api";
import { authHeaderToken, markSessionInvalidated } from "./credential";

// ============================================================================
// Configuration
// ============================================================================

/** Get environment variable safely (works in both Node and browser) */
function getEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

/** API configuration - can be modified for testing */
export const apiConfig = {
  /** GraphQL endpoint URL */
  endpoint: getEnv("MATTERS_API_ENDPOINT") || "https://server.matters.town/graphql",
  /** Query mode: "viewer" (requires auth) or "user" (public, for testing) */
  queryMode: (getEnv("MATTERS_QUERY_MODE") || "viewer") as "viewer" | "user",
  /** Username for user queries in test mode */
  testUserName: getEnv("MATTERS_TEST_USER") || "Matty",
};

/** @deprecated Use apiConfig.endpoint instead */
export const GRAPHQL_ENDPOINT = "https://server.matters.town/graphql";

// ============================================================================
// GraphQL Queries
// ============================================================================

export const ARTICLES_QUERY = `
query MePublishedArticles($after: String) {
  viewer {
    id
    userName
    articles(input: { first: 50, after: $after, filter: { state: active } }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          slug
          shortHash
          content
          summary
          createdAt
          revisedAt
          tags {
            id
            content
          }
          cover
        }
      }
    }
  }
}
`;

export const DRAFTS_QUERY = `
query MeDrafts($after: String) {
  viewer {
    id
    drafts(input: { first: 50, after: $after }) {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          content
          summary
          createdAt
          updatedAt
          tags
          cover
        }
      }
    }
  }
}
`;

export const COLLECTIONS_QUERY = `
query MeCollections($after: String) {
  viewer {
    id
    collections(input: { first: 50, after: $after }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          description
          cover
          articles(input: { first: 100 }) {
            edges {
              node {
                id
                shortHash
                title
                slug
              }
            }
          }
        }
      }
    }
  }
}
`;

export const PROFILE_QUERY = `
query MeProfile {
  viewer {
    id
    userName
    displayName
    info {
      description
      profileCover
    }
    avatar
    settings {
      language
    }
    pinnedWorks {
      id
      pinned
      title
      cover
      __typename
      ... on Article {
        slug
        shortHash
      }
    }
  }
}
`;

// ============================================================================
// User Queries (for testing - no authentication required)
// ============================================================================

export const USER_ARTICLES_QUERY = `
query UserArticles($userName: String!, $after: String) {
  user(input: { userName: $userName }) {
    id
    userName
    articles(input: { first: 50, after: $after, filter: { state: active } }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          slug
          shortHash
          content
          summary
          language
          createdAt
          revisedAt
          tags {
            id
            content
          }
          cover
        }
      }
    }
  }
}
`;

export const USER_COLLECTIONS_QUERY = `
query UserCollections($userName: String!, $after: String) {
  user(input: { userName: $userName }) {
    id
    collections(input: { first: 50, after: $after }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          description
          cover
          articles(input: { first: 100 }) {
            edges {
              node {
                id
                shortHash
                title
                slug
              }
            }
          }
        }
      }
    }
  }
}
`;

export const USER_PROFILE_QUERY = `
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
    pinnedWorks {
      id
      pinned
      title
      cover
      __typename
      ... on Article {
        slug
        shortHash
      }
    }
  }
}
`;

// ============================================================================
// Lightweight comment-count discovery queries
// ============================================================================

/**
 * Fetch only `{shortHash, commentCount}` for every published article. Used to
 * decide which articles need a full comments fetch this sync.
 */
export const VIEWER_ARTICLE_COMMENT_COUNTS_QUERY = `
query ViewerArticleCommentCounts($after: String) {
  viewer {
    id
    articles(input: { first: 50, after: $after, filter: { state: active } }) {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          shortHash
          commentCount
        }
      }
    }
  }
}
`;

export const USER_ARTICLE_COMMENT_COUNTS_QUERY = `
query UserArticleCommentCounts($userName: String!, $after: String) {
  user(input: { userName: $userName }) {
    id
    articles(input: { first: 50, after: $after, filter: { state: active } }) {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          shortHash
          commentCount
        }
      }
    }
  }
}
`;

// ============================================================================
// Social Data Queries (Comments, Donations, Appreciations)
// ============================================================================

export const ARTICLE_COMMENTS_QUERY = `
query ArticleComments($shortHash: String!, $after: String) {
  article(input: { shortHash: $shortHash }) {
    id
    shortHash
    comments(input: { first: 50, after: $after, sort: newest }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          content
          createdAt
          state
          upvotes
          author {
            id
            userName
            displayName
            avatar
          }
          replyTo {
            id
            author {
              userName
            }
          }
        }
      }
    }
  }
}
`;

export const ARTICLE_DONATIONS_QUERY = `
query ArticleDonations($shortHash: String!, $after: String) {
  article(input: { shortHash: $shortHash }) {
    id
    shortHash
    donations(input: { first: 50, after: $after }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          sender {
            id
            userName
            displayName
            avatar
          }
        }
      }
    }
  }
}
`;

export const ARTICLE_APPRECIATIONS_QUERY = `
query ArticleAppreciations($shortHash: String!, $after: String) {
  article(input: { shortHash: $shortHash }) {
    id
    shortHash
    appreciationsReceived(input: { first: 50, after: $after }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          amount
          createdAt
          sender {
            id
            userName
            displayName
            avatar
          }
        }
      }
    }
  }
}
`;

// ============================================================================
// Syndication Mutations (Draft/Collection Creation)
// ============================================================================

export const PUT_DRAFT_MUTATION = `
mutation PutDraft($input: PutDraftInput!) {
  putDraft(input: $input) {
    id
    title
    content
    summary
    createdAt
    updatedAt
    tags
    cover
    publishState
    article {
      id
      shortHash
      slug
    }
  }
}
`;

export const GET_DRAFT_QUERY = `
query GetDraft($id: ID!) {
  node(input: { id: $id }) {
    ... on Draft {
      id
      title
      publishState
      article {
        id
        shortHash
        slug
      }
    }
  }
}
`;

export const PUT_COLLECTION_MUTATION = `
mutation PutCollection($input: PutCollectionInput!) {
  putCollection(input: $input) {
    id
    title
  }
}
`;


/** GraphQL extensions.code values that mean "the session is dead". */
const AUTH_ERROR_CODES = new Set(["TOKEN_INVALID", "UNAUTHENTICATED"]);

/**
 * The Matters server rejected our credential. Matters signals this with
 * HTTP 500 (not 401) + extensions.code, so callers must catch this type
 * rather than match on status.
 */
export class MattersAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MattersAuthError";
    this.code = code;
  }
}

interface GraphqlErrorShape {
  message?: string;
  extensions?: { code?: string };
}

function findAuthErrorCode(parsed: unknown): string | null {
  const errors = (parsed as { errors?: GraphqlErrorShape[] } | null)?.errors;
  if (!Array.isArray(errors)) return null;
  for (const e of errors) {
    const code = e?.extensions?.code;
    if (code && AUTH_ERROR_CODES.has(code)) return code;
  }
  return null;
}

/** One-line, length-capped body excerpt for error messages and logs. */
function bodySnippet(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max) + "…";
}

/**
 * Shared response handling. `authenticated` gates auth-code detection: only
 * the token-bearing path may interpret TOKEN_INVALID/UNAUTHENTICATED as
 * evidence about OUR session and stamp it; the public path sends no token,
 * so the same body there is just a failed request.
 */
async function handleGraphqlResponse<T>(
  response: { ok: boolean; status: number; text(): string },
  authenticated: boolean
): Promise<T> {
  const text = response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // non-JSON body (e.g. an HTML error page); fall through to status check
  }

  if (authenticated) {
    const authCode = findAuthErrorCode(parsed);
    if (authCode) {
      await markSessionInvalidated();
      throw new MattersAuthError(authCode, `Matters rejected the session (${authCode})`);
    }
  }
  if (!response.ok) {
    throw new Error(`GraphQL request failed (${response.status}): ${bodySnippet(text)}`);
  }
  const result = parsed as { errors?: GraphqlErrorShape[]; data: T } | null;
  if (!result) {
    throw new Error(`GraphQL request failed (${response.status}): non-JSON response: ${bodySnippet(text)}`);
  }
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || "GraphQL error");
  }
  return result.data;
}

// ============================================================================
// GraphQL Client
// ============================================================================

/**
 * Make authenticated GraphQL request to Matters API
 */
export async function graphqlQuery<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = await authHeaderToken();
  if (!token) {
    throw new Error("No access token available. Please login first.");
  }

  const response = await httpPost(
    apiConfig.endpoint,
    { query, variables },
    {
      headers: {
        "x-access-token": token,
      },
      timeoutMs: 30000,
    }
  );

  return handleGraphqlResponse<T>(response, true);
}

/**
 * Make public (unauthenticated) GraphQL request to Matters API
 * Used for testing with the `user` field instead of `viewer`
 */
export async function graphqlQueryPublic<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  console.log(`[matters] graphqlQueryPublic: fetching with vars:`, JSON.stringify(variables));

  const response = await httpPost(
    apiConfig.endpoint,
    { query, variables },
    {
      headers: {
        "User-Agent": "MattersPlugin/1.0",
        Accept: "application/json",
      },
      timeoutMs: 30000,
    }
  );

  console.log(`[matters] graphqlQueryPublic: response status ${response.status}`);

  return handleGraphqlResponse<T>(response, false);
}

// ============================================================================
// Data Fetching Functions
// ============================================================================

/**
 * Fetch all published articles with pagination
 * Uses viewer query (authenticated) or user query (public) based on apiConfig.queryMode
 */
export async function fetchAllArticles(): Promise<{
  articles: MattersArticle[];
  userName: string;
}> {
  if (apiConfig.queryMode === "user") {
    return fetchUserArticles(apiConfig.testUserName);
  }
  return fetchViewerArticles();
}

/**
 * Fetch articles using authenticated viewer query
 */
async function fetchViewerArticles(): Promise<{
  articles: MattersArticle[];
  userName: string;
}> {
  const allArticles: MattersArticle[] = [];
  let cursor: string | undefined;
  let userName = "";

  console.log("📡 Fetching published articles from Matters (viewer mode)...");

  do {
    const data = await graphqlQuery<ViewerArticlesResponse>(ARTICLES_QUERY, {
      after: cursor,
    });

    if (!data.viewer) {
      throw new Error("Failed to fetch viewer data");
    }

    userName = data.viewer.userName;
    const { edges, pageInfo } = data.viewer.articles;

    for (const edge of edges) {
      allArticles.push(edge.node);
    }

    console.log(`   Fetched ${allArticles.length}/${data.viewer.articles.totalCount} articles...`);

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  return { articles: allArticles, userName };
}

/**
 * Fetch articles using public user query (no authentication required)
 */
async function fetchUserArticles(userName: string): Promise<{
  articles: MattersArticle[];
  userName: string;
}> {
  const allArticles: MattersArticle[] = [];
  let cursor: string | undefined;

  console.log(`📡 Fetching published articles from Matters (user mode: @${userName})...`);

  do {
    const data = await graphqlQueryPublic<UserArticlesQuery>(USER_ARTICLES_QUERY, {
      userName,
      after: cursor,
    });

    if (!data.user) {
      throw new Error(`Failed to fetch user data for @${userName}`);
    }

    const { edges, pageInfo } = data.user.articles;

    if (edges) {
      for (const edge of edges) {
        // Map UserArticlesQuery node to MattersArticle
        allArticles.push({
          id: edge.node.id,
          title: edge.node.title,
          slug: edge.node.slug,
          shortHash: edge.node.shortHash,
          content: edge.node.content,
          summary: edge.node.summary,
          language: edge.node.language ?? undefined,
          createdAt: edge.node.createdAt,
          revisedAt: edge.node.revisedAt ?? undefined,
          cover: edge.node.cover ?? undefined,
          tags: edge.node.tags?.map(t => ({ id: t.id, content: t.content })) ?? [],
        });
      }
    }

    console.log(`   Fetched ${allArticles.length}/${data.user.articles.totalCount} articles...`);

    cursor = pageInfo.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined;
  } while (cursor);

  return { articles: allArticles, userName };
}

/**
 * Fetch all drafts with pagination
 * Note: Drafts are only available via viewer query (requires authentication)
 * In user mode, returns an empty array
 */
export async function fetchAllDrafts(): Promise<MattersDraft[]> {
  // Drafts require authentication - not available via public user query
  if (apiConfig.queryMode === "user") {
    console.log("📡 Skipping drafts (not available in user mode)...");
    return [];
  }

  const allDrafts: MattersDraft[] = [];
  let cursor: string | undefined;

  console.log("📡 Fetching drafts from Matters (viewer mode)...");

  do {
    const data = await graphqlQuery<ViewerDraftsResponse>(DRAFTS_QUERY, {
      after: cursor,
    });

    if (!data.viewer) {
      throw new Error("Failed to fetch viewer data");
    }

    const { edges, pageInfo } = data.viewer.drafts;

    for (const edge of edges) {
      allDrafts.push(edge.node);
    }

    console.log(`   Fetched ${allDrafts.length} drafts...`);

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  return allDrafts;
}

/**
 * Fetch drafts created since a given timestamp
 *
 * Like fetchAllArticlesSince, fetches all drafts and filters client-side.
 * We filter by createdAt only (not updatedAt) for consistency with articles.
 *
 * @param since - ISO timestamp to filter drafts (optional, fetches all if not provided)
 */
export async function fetchAllDraftsSince(since?: string): Promise<MattersDraft[]> {
  const drafts = await fetchAllDrafts();

  if (!since) {
    console.log(`   📅 No lastSyncedAt, returning all ${drafts.length} drafts`);
    return drafts;
  }

  const sinceDate = new Date(since);
  const filteredDrafts = drafts.filter((draft) => {
    const draftDate = new Date(draft.createdAt);
    return draftDate > sinceDate;
  });

  console.log(`   📅 Filtered to ${filteredDrafts.length} new drafts since ${since}`);
  return filteredDrafts;
}

/**
 * Fetch all collections with pagination
 * Uses viewer query (authenticated) or user query (public) based on apiConfig.queryMode
 */
export async function fetchAllCollections(): Promise<MattersCollection[]> {
  if (apiConfig.queryMode === "user") {
    return fetchUserCollections(apiConfig.testUserName);
  }
  return fetchViewerCollections();
}

/**
 * Fetch collections using authenticated viewer query
 */
async function fetchViewerCollections(): Promise<MattersCollection[]> {
  const allCollections: MattersCollection[] = [];
  let cursor: string | undefined;

  console.log("📡 Fetching collections from Matters (viewer mode)...");

  do {
    const data = await graphqlQuery<ViewerCollectionsResponse>(COLLECTIONS_QUERY, {
      after: cursor,
    });

    if (!data.viewer) {
      throw new Error("Failed to fetch viewer data");
    }

    const { edges, pageInfo } = data.viewer.collections;

    for (const edge of edges) {
      const collection: MattersCollection = {
        id: edge.node.id,
        title: edge.node.title,
        description: edge.node.description,
        cover: edge.node.cover,
        articles: edge.node.articles.edges.map((e) => e.node),
      };
      allCollections.push(collection);
    }

    console.log(`   Fetched ${allCollections.length}/${data.viewer.collections.totalCount} collections...`);

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  return allCollections;
}

/**
 * Fetch collections using public user query (no authentication required)
 */
async function fetchUserCollections(userName: string): Promise<MattersCollection[]> {
  const allCollections: MattersCollection[] = [];
  let cursor: string | undefined;

  console.log(`📡 Fetching collections from Matters (user mode: @${userName})...`);

  do {
    const data = await graphqlQueryPublic<UserCollectionsQuery>(USER_COLLECTIONS_QUERY, {
      userName,
      after: cursor,
    });

    if (!data.user) {
      throw new Error(`Failed to fetch user data for @${userName}`);
    }

    const { edges, pageInfo } = data.user.collections;

    if (edges) {
      for (const edge of edges) {
        const collection: MattersCollection = {
          id: edge.node.id,
          title: edge.node.title,
          description: edge.node.description ?? undefined,
          cover: edge.node.cover ?? undefined,
          articles: edge.node.articles.edges?.map((e) => e.node) ?? [],
        };
        allCollections.push(collection);
      }
    }

    console.log(`   Fetched ${allCollections.length}/${data.user.collections.totalCount} collections...`);

    cursor = pageInfo.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined;
  } while (cursor);

  return allCollections;
}

/**
 * Fetch user profile including displayName, bio, and language preference
 * Uses viewer query (authenticated) or user query (public) based on apiConfig.queryMode
 */
export async function fetchUserProfile(): Promise<MattersUserProfile> {
  if (apiConfig.queryMode === "user") {
    return fetchUserProfilePublic(apiConfig.testUserName);
  }
  return fetchViewerProfile();
}

/**
 * Fetch profile using authenticated viewer query
 */
async function fetchViewerProfile(): Promise<MattersUserProfile> {
  console.log("📡 Fetching user profile from Matters (viewer mode)...");

  const data = await graphqlQuery<ViewerProfileResponse>(PROFILE_QUERY);

  if (!data.viewer) {
    throw new Error("Failed to fetch user profile");
  }

  const profile: MattersUserProfile = {
    userName: data.viewer.userName,
    displayName: data.viewer.displayName,
    description: data.viewer.info?.description,
    avatar: data.viewer.avatar,
    profileCover: data.viewer.info?.profileCover,
    language: data.viewer.settings?.language,
    pinnedWorks: (data.viewer.pinnedWorks || []).map((work) => ({
      id: work.id,
      type: work.__typename === "Article" ? "article" as const : "collection" as const,
      title: work.title,
      slug: work.__typename === "Article" ? work.slug : undefined,
      shortHash: work.__typename === "Article" ? work.shortHash : undefined,
      cover: work.cover,
    })),
  };

  console.log(`   Profile: ${profile.displayName} (@${profile.userName})`);
  console.log(`   Language: ${profile.language || "not set"}`);

  return profile;
}

/**
 * Fetch profile using public user query (no authentication required)
 */
async function fetchUserProfilePublic(userName: string): Promise<MattersUserProfile> {
  console.log(`📡 Fetching user profile from Matters (user mode: @${userName})...`);

  const data = await graphqlQueryPublic<UserProfileQuery>(USER_PROFILE_QUERY, {
    userName,
  });

  if (!data.user) {
    throw new Error(`Failed to fetch user profile for @${userName}`);
  }

  // Cast to access pinnedWorks which may not be in the generated types yet
  const userData = data.user as NonNullable<UserProfileQuery["user"]> & {
    pinnedWorks?: Array<{
      id: string;
      pinned: boolean;
      title: string;
      cover?: string;
      __typename?: string;
      slug?: string;
      shortHash?: string;
    }>;
  };

  const profile: MattersUserProfile = {
    userName: userData.userName ?? userName,
    displayName: userData.displayName ?? userName,
    description: userData.info?.description ?? undefined,
    avatar: userData.avatar ?? undefined,
    profileCover: userData.info?.profileCover ?? undefined,
    language: userData.settings?.language,
    pinnedWorks: (userData.pinnedWorks || []).map((work) => ({
      id: work.id,
      type: work.__typename === "Article" ? "article" as const : "collection" as const,
      title: work.title,
      slug: work.__typename === "Article" ? work.slug : undefined,
      shortHash: work.__typename === "Article" ? work.shortHash : undefined,
      cover: work.cover,
    })),
  };

  console.log(`   Profile: ${profile.displayName} (@${profile.userName})`);
  console.log(`   Language: ${profile.language || "not set"}`);

  return profile;
}

// ============================================================================
// Social Data Fetching Functions
// ============================================================================

/**
 * Fetch `commentCount` for every published article in one (paginated) pass.
 *
 * Returns a map keyed by `shortHash`. Used by the social-sync loop to skip
 * the per-article comments query when the count hasn't moved since last sync.
 *
 * Picks the query mode (viewer/user) from `apiConfig.queryMode`, matching
 * `fetchAllArticles()`.
 */
export async function fetchAllArticleCommentCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let cursor: string | undefined;

  if (apiConfig.queryMode === "user") {
    const userName = apiConfig.testUserName;
    do {
      const data = await graphqlQueryPublic<UserArticleCommentCountsResponse>(
        USER_ARTICLE_COMMENT_COUNTS_QUERY,
        { userName, after: cursor }
      );

      const articles = data.user?.articles;
      if (!articles) break;

      for (const edge of articles.edges) {
        counts.set(edge.node.shortHash, edge.node.commentCount);
      }

      cursor = articles.pageInfo.hasNextPage ? articles.pageInfo.endCursor : undefined;
    } while (cursor);
  } else {
    do {
      const data = await graphqlQuery<ViewerArticleCommentCountsResponse>(
        VIEWER_ARTICLE_COMMENT_COUNTS_QUERY,
        { after: cursor }
      );

      if (!data.viewer) break;

      const { edges, pageInfo } = data.viewer.articles;
      for (const edge of edges) {
        counts.set(edge.node.shortHash, edge.node.commentCount);
      }

      cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
    } while (cursor);
  }

  return counts;
}

/**
 * Fetch all comments for an article with pagination
 * Works in both authenticated and public modes
 */
export async function fetchArticleComments(
  shortHash: string,
  knownIds?: Set<string>,
  sinceTimestamp?: string
): Promise<MattersComment[]> {
  const allComments: MattersComment[] = [];
  let cursor: string | undefined;

  console.log(`   📝 Fetching comments for article ${shortHash}...`);

  do {
    // Comments can be fetched publicly via article query
    const data = await graphqlQueryPublic<ArticleCommentsResponse>(
      ARTICLE_COMMENTS_QUERY,
      { shortHash, after: cursor }
    );

    if (!data.article) {
      console.warn(`   ⚠️ Article ${shortHash} not found`);
      return [];
    }

    const { edges, pageInfo } = data.article.comments;

    for (const edge of edges) {
      const node = edge.node;
      allComments.push({
        id: node.id,
        content: node.content,
        createdAt: node.createdAt,
        state: node.state as "active" | "archived" | "banned" | "collapsed",
        upvotes: node.upvotes,
        author: {
          id: node.author.id,
          userName: node.author.userName,
          displayName: node.author.displayName,
          avatar: node.author.avatar,
        },
        replyToId: node.replyTo?.id,
        replyToAuthor: node.replyTo?.author?.userName,
      });
    }

    // Early exit: if all comments on this page are already known, no need
    // to paginate further (comments are sorted newest-first)
    if (knownIds && knownIds.size > 0 && edges.length > 0) {
      const allKnown = edges.every(edge => knownIds.has(edge.node.id));
      if (allKnown) {
        console.log(`   📝 All comments on this page already known, stopping early`);
        break;
      }
    }

    // Timestamp-based early exit: comments are sorted newest-first, so once
    // the oldest comment on this page is at or before sinceTimestamp, all
    // remaining pages are older — stop pagination.
    if (sinceTimestamp && edges.length > 0) {
      const oldestOnPage = edges[edges.length - 1].node.createdAt;
      if (oldestOnPage <= sinceTimestamp) {
        break;
      }
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  // Filter out comments at or before sinceTimestamp (handles the last page
  // which may contain a mix of old and new comments)
  if (sinceTimestamp) {
    const filtered = allComments.filter(c => c.createdAt > sinceTimestamp);
    console.log(`   📝 Found ${filtered.length} new comments (${allComments.length - filtered.length} older than last sync, skipped)`);
    return filtered;
  }

  console.log(`   📝 Found ${allComments.length} comments`);
  return allComments;
}

/**
 * Fetch all donations for an article with pagination
 * Works in both authenticated and public modes
 */
export async function fetchArticleDonations(shortHash: string): Promise<MattersDonation[]> {
  const allDonations: MattersDonation[] = [];
  let cursor: string | undefined;

  console.log(`   💰 Fetching donations for article ${shortHash}...`);

  do {
    const data = await graphqlQueryPublic<ArticleDonationsResponse>(
      ARTICLE_DONATIONS_QUERY,
      { shortHash, after: cursor }
    );

    if (!data.article) {
      console.warn(`   ⚠️ Article ${shortHash} not found`);
      return [];
    }

    const { edges, pageInfo } = data.article.donations;

    for (const edge of edges) {
      const node = edge.node;
      allDonations.push({
        id: node.id,
        sender: {
          id: node.sender.id,
          userName: node.sender.userName,
          displayName: node.sender.displayName,
          avatar: node.sender.avatar,
        },
      });
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  console.log(`   💰 Found ${allDonations.length} donations`);
  return allDonations;
}

/**
 * Fetch all appreciations for an article with pagination
 * Works in both authenticated and public modes
 */
export async function fetchArticleAppreciations(shortHash: string): Promise<MattersAppreciation[]> {
  const allAppreciations: MattersAppreciation[] = [];
  let cursor: string | undefined;

  console.log(`   👏 Fetching appreciations for article ${shortHash}...`);

  do {
    const data = await graphqlQueryPublic<ArticleAppreciationsResponse>(
      ARTICLE_APPRECIATIONS_QUERY,
      { shortHash, after: cursor }
    );

    if (!data.article) {
      console.warn(`   ⚠️ Article ${shortHash} not found`);
      return [];
    }

    const { edges, pageInfo } = data.article.appreciationsReceived;

    for (const edge of edges) {
      const node = edge.node;
      allAppreciations.push({
        amount: node.amount,
        createdAt: node.createdAt,
        sender: {
          id: node.sender.id,
          userName: node.sender.userName,
          displayName: node.sender.displayName,
          avatar: node.sender.avatar,
        },
      });
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  const totalClaps = allAppreciations.reduce((sum, a) => sum + a.amount, 0);
  console.log(`   👏 Found ${allAppreciations.length} appreciators (${totalClaps} total claps)`);
  return allAppreciations;
}

// ============================================================================
// Incremental Sync Functions
// ============================================================================

/**
 * Fetch articles created since a given timestamp
 *
 * Note: The Matters API doesn't support direct datetime filtering on viewer.articles,
 * so we fetch all articles and filter client-side by createdAt.
 *
 * We intentionally filter by createdAt only (not revisedAt) to implement a
 * "download new content only" model. Remote edits are ignored to avoid
 * overwriting local changes.
 *
 * @param since - ISO timestamp to filter articles (optional, fetches all if not provided)
 */
export async function fetchAllArticlesSince(since?: string): Promise<{
  articles: MattersArticle[];
  userName: string;
}> {
  const { articles, userName } = await fetchAllArticles();

  if (!since) {
    console.log(`   📅 No lastSyncedAt, returning all ${articles.length} articles`);
    return { articles, userName };
  }

  const sinceDate = new Date(since);
  const filteredArticles = articles.filter((article) => {
    // Filter by createdAt only - ignore revisedAt to avoid overwriting local edits
    const articleDate = new Date(article.createdAt);
    return articleDate > sinceDate;
  });

  console.log(`   📅 Filtered to ${filteredArticles.length} new articles since ${since}`);
  return { articles: filteredArticles, userName };
}

// ============================================================================
// Syndication Functions (Draft/Collection Creation)
// ============================================================================

export const SINGLE_FILE_UPLOAD_MUTATION = `
mutation SingleFileUpload($input: SingleFileUploadInput!) {
  singleFileUpload(input: $input) {
    id
    path
  }
}
`;


/**
 * Upload an asset to Matters by sending its BYTES via multipart — the same
 * mechanism Matters' own editor uses — instead of asking Matters to fetch it
 * by URL.
 *
 * Why bytes, not URL: Matters' server cannot reliably fetch assets from
 * arbitrary deployed sites (e.g. Caddy/moss-seta-hosted sites return
 * `UNABLE_TO_UPLOAD_FROM_URL`), and the `embedaudio` asset type rejects
 * url-upload entirely. So callers read the asset bytes from the local build
 * output (`readSiteFile`, already base64) and POST them here.
 *
 * Uses the GraphQL multipart request spec (operations/map/file) via
 * `httpPostMultipart`. Requires the `apollo-require-preflight` header — without
 * it Matters' Apollo server rejects the multipart POST as potential CSRF.
 *
 * @param base64 - File bytes, base64-encoded (e.g. straight from readSiteFile)
 * @param filename - Display filename for the upload
 * @param contentType - MIME type (e.g. "image/jpeg", "audio/mpeg")
 * @param assetType - Matters AssetType: "embed" (image), "embedaudio" (audio), or "cover"
 * @param entityId - Draft ID the asset attaches to (required by singleFileUpload)
 * @returns The uploaded asset's `{ id, path }` (path = the Matters CDN URL)
 */
export async function uploadAssetMultipart(
  base64: string,
  filename: string,
  contentType: string,
  assetType: "embed" | "embedaudio" | "cover",
  entityId: string,
): Promise<{ id: string; path: string }> {
  const token = await authHeaderToken();
  if (!token) {
    throw new Error("No access token available. Please login first.");
  }

  const operations = JSON.stringify({
    query: SINGLE_FILE_UPLOAD_MUTATION,
    variables: { input: { type: assetType, entityType: "draft", entityId, file: null } },
  });
  const map = JSON.stringify({ "0": ["variables.input.file"] });

  const response = await httpPostMultipart(
    apiConfig.endpoint,
    {
      textFields: [
        { name: "operations", value: operations },
        { name: "map", value: map },
      ],
      files: [{ field: "0", filename, contentType, contentBase64: base64 }],
    },
    {
      headers: {
        "x-access-token": token,
        // Required: Matters' Apollo server treats a bare multipart POST as a
        // potential CSRF attack and rejects it without this preflight opt-in.
        "apollo-require-preflight": "true",
      },
      timeoutMs: 60000,
    },
  );

  const data = await handleGraphqlResponse<{ singleFileUpload: { id: string; path: string } }>(
    response,
    true,
  );
  return data.singleFileUpload;
}

/**
 * Create or update a draft on Matters
 */
export async function createDraft(input: PutDraftInput): Promise<MattersDraftWithArticle> {
  console.log(`   📝 Creating draft: ${input.title}`);

  const data = await graphqlQuery<PutDraftResponse>(PUT_DRAFT_MUTATION, {
    input,
  });

  console.log(`   ✅ Draft created with ID: ${data.putDraft.id}`);
  return data.putDraft;
}

/**
 * Fetch a draft by ID to check its publish state
 */
export async function fetchDraft(draftId: string): Promise<MattersDraftWithArticle | null> {
  interface GetDraftResponse {
    node: MattersDraftWithArticle | null;
  }

  const data = await graphqlQuery<GetDraftResponse>(GET_DRAFT_QUERY, {
    id: draftId,
  });

  return data.node;
}

/**
 * Create a new collection on Matters
 */
export async function createCollection(input: PutCollectionInput): Promise<{ id: string; title: string }> {
  console.log(`   📁 Creating collection: ${input.title}`);

  const data = await graphqlQuery<PutCollectionResponse>(PUT_COLLECTION_MUTATION, {
    input,
  });

  console.log(`   ✅ Collection created with ID: ${data.putCollection.id}`);
  return data.putCollection;
}
