import { describe, it, expect } from "vitest";
import { overallProgress } from "../progress";

describe("overallProgress", () => {
  it("returns 0 at start of first phase", () => {
    expect(overallProgress("authentication", 0, 1)).toBe(0);
  });

  it("returns 100 at end of last phase", () => {
    expect(overallProgress("complete", 1, 1)).toBe(100);
  });

  it("monotonically increases across all phase boundaries", () => {
    const values = [
      overallProgress("authentication", 0, 1),
      overallProgress("authentication", 1, 1),
      overallProgress("fetching_articles", 0, 1),
      overallProgress("fetching_articles", 1, 1),
      overallProgress("fetching_drafts", 0, 1),
      overallProgress("fetching_drafts", 1, 1),
      overallProgress("fetching_collections", 0, 1),
      overallProgress("fetching_collections", 1, 1),
      overallProgress("fetching_profile", 0, 1),
      overallProgress("fetching_profile", 1, 1),
      overallProgress("syncing", 0, 10),
      overallProgress("syncing", 5, 10),
      overallProgress("syncing", 10, 10),
      overallProgress("downloading_media", 0, 50),
      overallProgress("downloading_media", 25, 50),
      overallProgress("downloading_media", 50, 50),
      overallProgress("rewriting_links", 0, 1),
      overallProgress("rewriting_links", 1, 1),
      overallProgress("fetching_social", 0, 20),
      overallProgress("fetching_social", 10, 20),
      overallProgress("fetching_social", 20, 20),
      overallProgress("complete", 1, 1),
    ];

    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  it("handles zero total gracefully", () => {
    const result = overallProgress("downloading_media", 0, 0);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it("handles unknown phase gracefully", () => {
    const result = overallProgress("unknown_phase", 5, 10);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it("returns intermediate values within a phase", () => {
    const start = overallProgress("downloading_media", 0, 100);
    const mid = overallProgress("downloading_media", 50, 100);
    const end = overallProgress("downloading_media", 100, 100);

    expect(mid).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(mid);
  });

  it("treats sub-phases as part of their parent phase", () => {
    // syncing_homepage, syncing_collections, syncing_articles, syncing_drafts
    // should all map to the "syncing" weight band
    const syncStart = overallProgress("syncing", 0, 10);
    const homepageProgress = overallProgress("syncing_homepage", 1, 10);
    const collectionsProgress = overallProgress("syncing_collections", 3, 10);
    const articlesProgress = overallProgress("syncing_articles", 7, 10);
    const draftsProgress = overallProgress("syncing_drafts", 9, 10);
    const syncEnd = overallProgress("syncing", 10, 10);

    // All syncing sub-phases should fall within the syncing band
    expect(homepageProgress).toBeGreaterThanOrEqual(syncStart);
    expect(homepageProgress).toBeLessThanOrEqual(syncEnd);
    expect(collectionsProgress).toBeGreaterThanOrEqual(syncStart);
    expect(articlesProgress).toBeGreaterThanOrEqual(syncStart);
    expect(draftsProgress).toBeGreaterThanOrEqual(syncStart);
  });

  it("never exceeds 100", () => {
    // Even with current > total
    const result = overallProgress("complete", 5, 1);
    expect(result).toBeLessThanOrEqual(100);
  });

  it("never goes below 0", () => {
    const result = overallProgress("authentication", 0, 100);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});
