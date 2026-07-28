/**
 * Plugin-specific type definitions for the Matters Syndicator Plugin
 *
 * Common types (ProcessContext, SyndicateContext, HookResult, etc.) are
 * imported from moss-plugin-sdk.
 */

// Re-export SDK types for convenience
export type {
  ProcessContext,
  SyndicateContext,
  HookResult,
  DeploymentInfo,
  ProjectInfo,
  ArticleInfo,
  PluginMessage,
} from "@symbiosis-lab/moss-api";

// ============================================================================
// Matters API Types
// ============================================================================

export interface PageInfo {
  endCursor: string;
  hasNextPage: boolean;
}

export interface MattersTag {
  id: string;
  content: string;
}

export interface MattersArticle {
  id: string;
  title: string;
  slug: string;
  shortHash: string;
  content: string; // HTML content
  summary: string;
  createdAt: string;
  revisedAt?: string;
  tags: MattersTag[];
  cover?: string;
  language?: string; // e.g. "zh_hans" / "zh_hant" / "en" — public per-article language (G)
}

export interface MattersDraft {
  id: string;
  title: string;
  content: string; // HTML content
  summary?: string;
  createdAt: string;
  updatedAt?: string;
  tags?: string[];
  cover?: string;
}

export interface MattersCollectionArticle {
  id: string;
  shortHash: string;
  title: string;
  slug: string;
}

export interface MattersCollection {
  id: string;
  title: string;
  description?: string;
  cover?: string;
  articles: MattersCollectionArticle[];
}

export interface MattersPinnedWork {
  id: string;
  type: "article" | "collection";
  title: string;
  slug?: string;       // articles only
  shortHash?: string;   // articles only
  cover?: string;
}

export interface MattersUserProfile {
  userName: string;
  displayName: string;
  description?: string;
  avatar?: string;
  profileCover?: string;
  language?: string; // e.g., "zh_hans", "zh_hant", "en"
  pinnedWorks?: MattersPinnedWork[];  // optional for backwards compat
}

// ============================================================================
// Internal Types
// ============================================================================

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Extended sync result that includes the article path map for link rewriting.
 * The articlePathMap maps Matters URLs and shortHashes to local file paths.
 * syncedCollectionIds lists collections confirmed locally present this run
 * (created, identity-marker match, known gate, or path-existing skip) — the
 * caller persists union(stored, these) as knownCollectionIds, so a failed
 * creation is retried next run instead of being gated forever.
 */
export interface SyncResultWithMap {
  result: SyncResult;
  articlePathMap: Map<string, string>;
  syncedCollectionIds: string[];
}

export interface MediaDownloadResult {
  filesProcessed: number;
  imagesDownloaded: number;
  imagesSkipped: number;
  errors: string[];
}

export interface DownloadAndRewriteResult {
  content: string;
  downloadedCount: number;
  errors: string[];
}

export interface ExtractedMedia {
  url: string;
  localFilename: string;
}

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

// ============================================================================
// GraphQL Response Types
// ============================================================================

export interface ViewerArticlesResponse {
  viewer: {
    id: string;
    userName: string;
    articles: {
      totalCount: number;
      pageInfo: PageInfo;
      edges: Array<{
        node: MattersArticle;
      }>;
    };
  };
}

export interface ViewerDraftsResponse {
  viewer: {
    id: string;
    drafts: {
      pageInfo: PageInfo;
      edges: Array<{
        node: MattersDraft;
      }>;
    };
  };
}

export interface ViewerCollectionsResponse {
  viewer: {
    id: string;
    collections: {
      totalCount: number;
      pageInfo: PageInfo;
      edges: Array<{
        node: {
          id: string;
          title: string;
          description?: string;
          cover?: string;
          articles: {
            edges: Array<{
              node: MattersCollectionArticle;
            }>;
          };
        };
      }>;
    };
  };
}

export interface ViewerProfileResponse {
  viewer: {
    id: string;
    userName: string;
    displayName: string;
    info: {
      description?: string;
      profileCover?: string;
    };
    avatar?: string;
    settings: {
      language?: string;
    };
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
}

// ============================================================================
// Frontmatter Data Types
// ============================================================================

export interface FrontmatterData {
  title: string;
  /** Marks this file as its folder's home page (moss `home: true` marker). */
  home?: boolean;
  date?: string;
  updated?: string;
  tags?: string[];
  cover?: string;
  syndicated?: string[];
  description?: string;
  collections?: Record<string, number> | string[];
  order?: string[]; // For ordered folders: list of article filenames
}

// ============================================================================
// Social Data Types (for .moss/data/social/matters.json)
// ============================================================================

/**
 * User information for social interactions
 */
export interface SocialUser {
  id: string;
  userName: string;
  displayName: string;
  avatar?: string;
}

/**
 * Comment on an article
 */
export interface MattersComment {
  id: string;
  content: string;
  createdAt: string;
  state: "active" | "archived" | "banned" | "collapsed";
  upvotes: number;
  author: SocialUser;
  replyToId?: string;
  replyToAuthor?: string;
}

/**
 * Donation to an article
 */
export interface MattersDonation {
  id: string;
  sender: SocialUser;
}

/**
 * Appreciation (claps) for an article
 */
export interface MattersAppreciation {
  amount: number;
  createdAt: string;
  sender: SocialUser;
}

/**
 * Social data for a single article
 */
export interface ArticleSocialData {
  comments: MattersComment[];
  donations: MattersDonation[];
  appreciations: MattersAppreciation[];
  /**
   * commentCount as reported by Matters at the last successful sync.
   * Used to skip per-article fetches when the remote count hasn't changed.
   * Undefined for entries written before this field existed (treated as
   * "unknown" — sync will fetch as before, then populate this).
   */
  lastKnownCommentCount?: number;
}

/**
 * Complete social data stored in .moss/data/social/matters.json
 *
 * Schema:
 * - schemaVersion: Version string for future migrations (currently "1.0.0")
 * - updatedAt: ISO timestamp of last update
 * - articles: Map of source .md path (project-relative) to social data
 *
 * Merge strategy: Upsert by ID (add new, update existing, never delete)
 */
export interface MattersSocialData {
  /** Schema version for forward compatibility */
  schemaVersion: string;
  /** ISO timestamp of last update */
  updatedAt: string;
  /** Social data keyed by source .md path (project-relative) */
  articles: Record<string, ArticleSocialData>;
}

// ============================================================================
// Lightweight Comment-Count Discovery Types
// ============================================================================

/**
 * Minimal article node for the "which articles have new comments?" query.
 * Just enough to join against local social data and compare counts.
 */
export interface ArticleCommentCount {
  shortHash: string;
  commentCount: number;
}

export interface ViewerArticleCommentCountsResponse {
  viewer: {
    id: string;
    articles: {
      pageInfo: PageInfo;
      edges: Array<{ node: ArticleCommentCount }>;
    };
  };
}

export interface UserArticleCommentCountsResponse {
  user: {
    id: string;
    articles: {
      pageInfo: PageInfo;
      edges: Array<{ node: ArticleCommentCount }>;
    } | null;
  } | null;
}

// ============================================================================
// Social Data GraphQL Response Types
// ============================================================================

export interface ArticleCommentsResponse {
  article: {
    id: string;
    shortHash: string;
    comments: {
      totalCount: number;
      pageInfo: PageInfo;
      edges: Array<{
        node: {
          id: string;
          content: string;
          createdAt: string;
          state: string;
          upvotes: number;
          author: {
            id: string;
            userName: string;
            displayName: string;
            avatar?: string;
          };
          replyTo?: {
            id: string;
            author: {
              userName: string;
            };
          };
        };
      }>;
    };
  };
}

export interface ArticleDonationsResponse {
  article: {
    id: string;
    shortHash: string;
    donations: {
      totalCount: number;
      pageInfo: PageInfo;
      edges: Array<{
        node: {
          id: string;
          sender: {
            id: string;
            userName: string;
            displayName: string;
            avatar?: string;
          };
        };
      }>;
    };
  };
}

export interface ArticleAppreciationsResponse {
  article: {
    id: string;
    shortHash: string;
    appreciationsReceived: {
      totalCount: number;
      pageInfo: PageInfo;
      edges: Array<{
        node: {
          amount: number;
          createdAt: string;
          sender: {
            id: string;
            userName: string;
            displayName: string;
            avatar?: string;
          };
        };
      }>;
    };
  };
}

// ============================================================================
// Draft/Syndication Types
// ============================================================================

export interface MattersDraftWithArticle extends MattersDraft {
  /** Present when draft has been published */
  article?: {
    id: string;
    shortHash: string;
    slug: string;
  };
  publishState: "unpublished" | "pending" | "published";
}

export interface PutDraftInput {
  id?: string;
  title?: string;
  content?: string;
  summary?: string;
  tags?: string[];
  cover?: string;
  collections?: string[];
}

export interface PutDraftResponse {
  putDraft: MattersDraftWithArticle;
}

export interface PublishArticleResponse {
  publishArticle: {
    id: string;
    article: {
      id: string;
      shortHash: string;
      slug: string;
    };
  };
}

export interface PutCollectionInput {
  id?: string;
  title?: string;
  cover?: string;
  description?: string;
  pinned?: boolean;
}

export interface PutCollectionResponse {
  putCollection: {
    id: string;
    title: string;
  };
}
