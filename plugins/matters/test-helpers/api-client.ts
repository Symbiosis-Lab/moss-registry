/**
 * Direct HTTP client for E2E tests against Matters API
 * Uses fetch directly without Tauri IPC
 */

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

const DEFAULT_ENDPOINT = "https://server.matters.icu/graphql";

export async function graphqlQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
  endpoint = DEFAULT_ENDPOINT
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
  }

  const result: GraphQLResponse<T> = await response.json();

  if (result.errors && result.errors.length > 0) {
    throw new Error(`GraphQL error: ${result.errors[0].message}`);
  }

  if (!result.data) {
    throw new Error("No data returned from GraphQL query");
  }

  return result.data;
}

// Pre-defined queries for testing

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
    settings {
      language
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

// Convenience functions for common operations

export interface UserArticle {
  id: string;
  title: string;
  slug: string;
  shortHash: string;
  content: string;
  summary: string;
  createdAt: string;
  revisedAt?: string;
  cover?: string;
  tags?: Array<{ id: string; content: string }>;
}

export interface UserProfile {
  id: string;
  userName: string;
  displayName: string;
  avatar?: string;
  info?: {
    description?: string;
    profileCover?: string;
  };
  settings?: {
    language?: string;
  };
}

export interface UserCollection {
  id: string;
  title: string;
  description?: string;
  cover?: string;
  articles: {
    edges?: Array<{
      node: {
        id: string;
        shortHash: string;
        title: string;
        slug: string;
      };
    }>;
  };
}

export async function fetchUserArticles(
  userName: string,
  endpoint = DEFAULT_ENDPOINT
): Promise<UserArticle[]> {
  const allArticles: UserArticle[] = [];
  let cursor: string | undefined;

  do {
    const data = await graphqlQuery<{
      user?: {
        articles: {
          edges?: Array<{ node: UserArticle }>;
          pageInfo: { endCursor?: string; hasNextPage: boolean };
        };
      };
    }>(USER_ARTICLES_QUERY, { userName, after: cursor }, endpoint);

    if (!data.user) {
      throw new Error(`User not found: ${userName}`);
    }

    const edges = data.user.articles.edges ?? [];
    for (const edge of edges) {
      allArticles.push(edge.node);
    }

    cursor = data.user.articles.pageInfo.hasNextPage
      ? data.user.articles.pageInfo.endCursor
      : undefined;
  } while (cursor);

  return allArticles;
}

export async function fetchUserProfile(
  userName: string,
  endpoint = DEFAULT_ENDPOINT
): Promise<UserProfile | null> {
  const data = await graphqlQuery<{
    user?: UserProfile;
  }>(USER_PROFILE_QUERY, { userName }, endpoint);

  return data.user ?? null;
}

export async function fetchUserCollections(
  userName: string,
  endpoint = DEFAULT_ENDPOINT
): Promise<UserCollection[]> {
  const allCollections: UserCollection[] = [];
  let cursor: string | undefined;

  do {
    const data = await graphqlQuery<{
      user?: {
        collections: {
          edges?: Array<{ node: UserCollection }>;
          pageInfo: { endCursor?: string; hasNextPage: boolean };
        };
      };
    }>(USER_COLLECTIONS_QUERY, { userName, after: cursor }, endpoint);

    if (!data.user) {
      throw new Error(`User not found: ${userName}`);
    }

    const edges = data.user.collections.edges ?? [];
    for (const edge of edges) {
      allCollections.push(edge.node);
    }

    cursor = data.user.collections.pageInfo.hasNextPage
      ? data.user.collections.pageInfo.endCursor
      : undefined;
  } while (cursor);

  return allCollections;
}
