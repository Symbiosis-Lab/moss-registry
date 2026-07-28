/**
 * Sample article fixtures for testing
 */

import type { MattersArticle, MattersDraft, MattersCollection, MattersUserProfile } from "../../src/types";

export const sampleArticle: MattersArticle = {
  id: "QXJ0aWNsZToxMjM0NQ==",
  title: "Test Article Title",
  slug: "test-article-title",
  shortHash: "abc123",
  content: "<p>This is the article content with <strong>bold</strong> and <em>italic</em> text.</p>",
  summary: "A brief summary of the article",
  createdAt: "2024-01-15T10:30:00Z",
  revisedAt: "2024-01-20T15:45:00Z",
  cover: "https://assets.matters.town/processed/abc123-cover.jpg",
  tags: [
    { id: "VGFnOjE=", content: "Technology" },
    { id: "VGFnOjI=", content: "Testing" },
  ],
};

export const sampleArticleWithImages: MattersArticle = {
  id: "QXJ0aWNsZTo2Nzg5MA==",
  title: "Article with Images",
  slug: "article-with-images",
  shortHash: "def456",
  content: `
    <p>Introduction paragraph.</p>
    <figure class="image">
      <img src="https://assets.matters.town/processed/image1.jpg" alt="First image">
      <figcaption>Caption for first image</figcaption>
    </figure>
    <p>Middle paragraph.</p>
    <figure class="image">
      <img src="https://assets.matters.town/processed/image2.png" alt="Second image">
    </figure>
    <p>Conclusion paragraph.</p>
  `,
  summary: "An article with embedded images",
  createdAt: "2024-02-01T08:00:00Z",
  tags: [],
};

export const sampleDraft: MattersDraft = {
  id: "RHJhZnQ6OTg3NjU=",
  title: "Draft in Progress",
  content: "<p>This is a draft that is still being written.</p>",
  summary: "Draft summary",
  createdAt: "2024-02-10T12:00:00Z",
  updatedAt: "2024-02-11T14:30:00Z",
  tags: ["WIP", "Ideas"],
  cover: undefined,
};

export const sampleCollection: MattersCollection = {
  id: "Q29sbGVjdGlvbjoxMjM=",
  title: "My Best Articles",
  description: "A collection of my favorite articles",
  cover: "https://assets.matters.town/processed/collection-cover.jpg",
  articles: [
    { id: "1", shortHash: "abc123", title: "Test Article Title", slug: "test-article-title" },
    { id: "2", shortHash: "def456", title: "Article with Images", slug: "article-with-images" },
  ],
};

export const sampleUserProfile: MattersUserProfile = {
  userName: "testuser",
  displayName: "Test User",
  description: "A test user for unit tests",
  avatar: "https://assets.matters.town/avatar/test.jpg",
  profileCover: "https://assets.matters.town/cover/test.jpg",
  language: "en",
};

export const sampleChineseUserProfile: MattersUserProfile = {
  userName: "zhongwen",
  displayName: "Traditional Chinese User",
  description: "Traditional Chinese User Description",
  avatar: "https://assets.matters.town/avatar/zh.jpg",
  language: "zh_hant",
};

// Create multiple articles for pagination testing
export function createMultipleArticles(count: number): MattersArticle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `QXJ0aWNsZToke2krMX0=`,
    title: `Article ${i + 1}`,
    slug: `article-${i + 1}`,
    shortHash: `hash${i + 1}`,
    content: `<p>Content for article ${i + 1}</p>`,
    summary: `Summary for article ${i + 1}`,
    createdAt: new Date(Date.now() - i * 86400000).toISOString(),
    tags: [{ id: `VGFnOiR7aX0=`, content: `Tag${i % 5}` }],
  }));
}

// Create articles that belong to multiple collections (for file mode testing)
export function createMultiCollectionArticles(): {
  articles: MattersArticle[];
  collections: MattersCollection[];
} {
  const articles: MattersArticle[] = [
    {
      id: "1",
      title: "Shared Article",
      slug: "shared-article",
      shortHash: "shared1",
      content: "<p>This article belongs to multiple collections</p>",
      summary: "Shared article summary",
      createdAt: "2024-01-01T00:00:00Z",
      tags: [],
    },
    {
      id: "2",
      title: "Exclusive Article",
      slug: "exclusive-article",
      shortHash: "excl1",
      content: "<p>This article belongs to only one collection</p>",
      summary: "Exclusive article summary",
      createdAt: "2024-01-02T00:00:00Z",
      tags: [],
    },
  ];

  const collections: MattersCollection[] = [
    {
      id: "col1",
      title: "Collection A",
      description: "First collection",
      articles: [
        { id: "1", shortHash: "shared1", title: "Shared Article", slug: "shared-article" },
        { id: "2", shortHash: "excl1", title: "Exclusive Article", slug: "exclusive-article" },
      ],
    },
    {
      id: "col2",
      title: "Collection B",
      description: "Second collection",
      articles: [
        { id: "1", shortHash: "shared1", title: "Shared Article", slug: "shared-article" },
      ],
    },
  ];

  return { articles, collections };
}
