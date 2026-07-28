/**
 * Social data storage module for Matters plugin
 *
 * Stores social interactions (comments, donations, appreciations) in
 * .moss/data/social/matters.json (moved from .moss/social/ in commit 3436fd636).
 *
 * Schema Documentation:
 * ---------------------
 * The file stores a MattersSocialData object with:
 * - schemaVersion: "1.0.0" - Version for future migrations
 * - updatedAt: ISO timestamp of last update
 * - articles: Map of source .md path (project-relative) to ArticleSocialData
 *
 * Each ArticleSocialData contains:
 * - comments: Array of MattersComment
 * - donations: Array of MattersDonation
 * - appreciations: Array of MattersAppreciation
 *
 * Merge Strategy:
 * ---------------
 * When syncing, we use upsert semantics:
 * - New items (by ID) are added
 * - Existing items (by ID) are updated
 * - Items are NEVER removed (to preserve data from different sync runs)
 *
 * This allows multiple plugins to write to separate files in .moss/data/social/
 * and moss can aggregate them when rendering.
 */

import { writeFile, readFile, fileExists } from "@symbiosis-lab/moss-api";
import type {
  MattersSocialData,
  ArticleSocialData,
  MattersComment,
  MattersDonation,
  MattersAppreciation,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

/** Canonical path: written and read by both the plugin and moss readers. */
const SOCIAL_FILE_PATH = ".moss/data/social/matters.json";

/**
 * Legacy path written by plugin versions prior to commit 3436fd636 (Apr 8).
 * moss readers moved to .moss/data/social/ but the plugin continued writing
 * the old path — see issue #793.  reconcileLegacySocialData() detects this
 * file, merges it into SOCIAL_FILE_PATH, and renames it to
 * LEGACY_SOCIAL_FILE_MIGRATED so the one-time migration is idempotent.
 */
const LEGACY_SOCIAL_FILE_PATH = ".moss/social/matters.json";
const LEGACY_SOCIAL_FILE_MIGRATED = ".moss/social/matters.json.migrated-bak";
const SCHEMA_VERSION = "1.0.0";

// ============================================================================
// Legacy Migration
// ============================================================================

/**
 * Merge comments from legacy into current, deduped by ID.
 * Prefers the entry with MORE comments when both sides have the same article.
 */
export function mergeCommentsDeduped(
  current: MattersComment[],
  legacy: MattersComment[]
): MattersComment[] {
  const commentMap = new Map<string, MattersComment>();
  for (const c of current) commentMap.set(c.id, c);
  for (const c of legacy) {
    if (!commentMap.has(c.id)) commentMap.set(c.id, c);
  }
  return Array.from(commentMap.values());
}

/**
 * Reconcile legacy .moss/social/matters.json into .moss/data/social/matters.json.
 *
 * One-time migration: if the legacy file exists, its articles are union-merged
 * into `current` (the data already loaded from the canonical path):
 *
 * - shortHash-keyed entries in legacy are remapped → uid via `shortHashToUid`.
 * - uid-keyed entries merge directly.
 * - unknown keys carry over as-is (archive).
 * - Comments are deduped by ID; the side with MORE comments wins per article.
 * - `lastKnownCommentCount` is cleared when it exceeds the actual stored count
 *   (poisoned entries) so the next sync refetches.
 *
 * After merging, the result is written to SOCIAL_FILE_PATH and the legacy file
 * is renamed to LEGACY_SOCIAL_FILE_MIGRATED.  Idempotent: if legacy file does
 * not exist (or the migrated-bak file already exists) this is a no-op.
 *
 * @param current - Already-loaded canonical store (mutated in place).
 * @param shortHashToUid - Mapping produced by scanLocalArticles(): shortHash → uid.
 * @returns `true` if a migration was performed, `false` if no-op.
 */
export async function reconcileLegacySocialData(
  current: MattersSocialData,
  shortHashToUid: Map<string, string>
): Promise<boolean> {
  // Idempotent guard: legacy file must exist and not yet migrated.
  const legacyExists = await fileExists(LEGACY_SOCIAL_FILE_PATH);
  if (!legacyExists) return false;

  const migratedExists = await fileExists(LEGACY_SOCIAL_FILE_MIGRATED);
  if (migratedExists) return false;

  // Read the legacy file ONCE and reuse the content for both parse and bak-copy.
  let legacyContent: string;
  let legacyData: MattersSocialData;
  try {
    legacyContent = await readFile(LEGACY_SOCIAL_FILE_PATH);
    legacyData = JSON.parse(legacyContent) as MattersSocialData;
    if (!legacyData.schemaVersion || !legacyData.articles) {
      console.warn("[matters] Legacy social file invalid — skipping reconcile");
      return false;
    }
  } catch (e) {
    console.warn(`[matters] Could not read legacy social file: ${e}`);
    return false;
  }

  console.log(`[matters] Reconciling legacy social data (${Object.keys(legacyData.articles).length} entries)`);

  for (const [legacyKey, legacyArticle] of Object.entries(legacyData.articles)) {
    // Resolve the canonical key: remap shortHash → uid if we have a mapping.
    const uid = shortHashToUid.get(legacyKey);
    const canonicalKey = uid ?? legacyKey;

    const existing = current.articles[canonicalKey];
    if (existing) {
      // Prefer the richer side (more comments) then deduplicate.
      const merged = existing.comments.length >= legacyArticle.comments.length
        ? mergeCommentsDeduped(existing.comments, legacyArticle.comments)
        : mergeCommentsDeduped(legacyArticle.comments, existing.comments);

      // Clear a poisoned lastKnownCommentCount (stored count > actual comments).
      const mergedCount = merged.length;
      const storedCount = existing.lastKnownCommentCount;
      const clearCount = storedCount !== undefined && storedCount > mergedCount;

      current.articles[canonicalKey] = {
        ...existing,
        comments: merged,
        lastKnownCommentCount: clearCount ? undefined : storedCount,
      };
    } else {
      // No existing entry — bring the legacy article in as-is.
      const storedCount = legacyArticle.lastKnownCommentCount;
      const clearCount =
        storedCount !== undefined && storedCount > legacyArticle.comments.length;
      current.articles[canonicalKey] = {
        ...legacyArticle,
        lastKnownCommentCount: clearCount ? undefined : storedCount,
      };
    }
  }

  // Write the merged result to the canonical path.
  await saveSocialData(current);

  // Retire the legacy file by writing a migrated-bak copy (reuse already-read content).
  try {
    await writeFile(LEGACY_SOCIAL_FILE_MIGRATED, legacyContent);
    console.log("[matters] Legacy social file archived to .migrated-bak");
  } catch (e) {
    // Non-fatal: canonical data is already saved; the guard on migratedExists
    // will run the migration again on the next sync, which is safe (idempotent
    // merge). Log only so operators can inspect.
    console.warn(`[matters] Could not write migrated-bak (will retry next sync): ${e}`);
    return true;
  }

  // Overwrite legacy path with a forwarding stub so naive readers see a message
  // rather than stale data.
  try {
    const stub = JSON.stringify({
      schemaVersion: "1.0.0",
      updatedAt: new Date().toISOString(),
      articles: {},
      _migrated: true,
      _note: "Data moved to .moss/data/social/matters.json (issue #793)",
    }, null, 2);
    await writeFile(LEGACY_SOCIAL_FILE_PATH, stub);
  } catch {
    // Non-fatal; backed-up copy is already in migrated-bak.
  }

  console.log(`[matters] Legacy reconcile complete: ${Object.keys(legacyData.articles).length} entries merged`);
  return true;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create an empty social data structure
 */
function createEmptySocialData(): MattersSocialData {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    articles: {},
  };
}

/**
 * Create an empty article social data structure
 */
function createEmptyArticleSocialData(): ArticleSocialData {
  return {
    comments: [],
    donations: [],
    appreciations: [],
  };
}

/**
 * Load social data from .moss/data/social/matters.json
 *
 * Returns empty data structure if file doesn't exist or is invalid.
 */
export async function loadSocialData(): Promise<MattersSocialData> {
  try {
    const content = await readFile(SOCIAL_FILE_PATH);
    const data = JSON.parse(content) as MattersSocialData;

    // Validate schema version
    if (!data.schemaVersion || !data.articles) {
      console.warn("Invalid social data file, creating new one");
      return createEmptySocialData();
    }

    return data;
  } catch {
    // File doesn't exist or is invalid
    return createEmptySocialData();
  }
}

/**
 * Save social data to .moss/data/social/matters.json
 *
 * Creates the .moss/data/social/ directory if it doesn't exist (handled by writeFile).
 *
 * @throws Error if the file cannot be written (permissions, disk full, etc.)
 */
export async function saveSocialData(data: MattersSocialData): Promise<void> {
  data.updatedAt = new Date().toISOString();
  const content = JSON.stringify(data, null, 2);

  console.log(`[matters] saveSocialData: Writing ${content.length} bytes to ${SOCIAL_FILE_PATH}`);
  console.log(`[matters] saveSocialData: ${Object.keys(data.articles).length} articles in data`);

  try {
    const result = await writeFile(SOCIAL_FILE_PATH, content);
    console.log(`[matters] saveSocialData: writeFile returned:`, result);
  } catch (error) {
    // Log the error with context for debugging
    console.error(`[matters] saveSocialData: FAILED to write to ${SOCIAL_FILE_PATH}:`, error);
    throw error; // Re-throw to propagate to caller
  }
}

// ============================================================================
// Merge Functions
// ============================================================================

/**
 * Merge comments using upsert semantics (by ID)
 */
function mergeComments(
  existing: MattersComment[],
  incoming: MattersComment[]
): MattersComment[] {
  const commentMap = new Map<string, MattersComment>();

  // Add existing comments
  for (const comment of existing) {
    commentMap.set(comment.id, comment);
  }

  // Upsert incoming comments
  for (const comment of incoming) {
    commentMap.set(comment.id, comment);
  }

  return Array.from(commentMap.values());
}

/**
 * Merge donations using upsert semantics (by ID)
 */
function mergeDonations(
  existing: MattersDonation[],
  incoming: MattersDonation[]
): MattersDonation[] {
  const donationMap = new Map<string, MattersDonation>();

  for (const donation of existing) {
    donationMap.set(donation.id, donation);
  }

  for (const donation of incoming) {
    donationMap.set(donation.id, donation);
  }

  return Array.from(donationMap.values());
}

/**
 * Merge appreciations using upsert semantics
 * Note: Appreciations don't have unique IDs, so we use sender.id + createdAt as key
 */
function mergeAppreciations(
  existing: MattersAppreciation[],
  incoming: MattersAppreciation[]
): MattersAppreciation[] {
  const appreciationMap = new Map<string, MattersAppreciation>();

  const getKey = (a: MattersAppreciation) => `${a.sender.id}_${a.createdAt}`;

  for (const appreciation of existing) {
    appreciationMap.set(getKey(appreciation), appreciation);
  }

  for (const appreciation of incoming) {
    appreciationMap.set(getKey(appreciation), appreciation);
  }

  return Array.from(appreciationMap.values());
}

/**
 * Merge new social data into existing data for a specific article
 *
 * Uses upsert semantics: adds new items, updates existing, never removes.
 *
 * @param data - Existing social data structure (will be mutated)
 * @param articleKey - Article identifier (source .md path, project-relative)
 * @param comments - New comments to merge
 * @param donations - New donations to merge
 * @param appreciations - New appreciations to merge
 * @param commentCount - Optional remote commentCount to record as
 *   `lastKnownCommentCount` so the next sync can skip fetching when nothing
 *   has changed. Pass only when you actually fetched comments — leave
 *   undefined for syndicate-time merges that don't observe remote state.
 * @returns The mutated data object
 */
export function mergeSocialData(
  data: MattersSocialData,
  articleKey: string,
  comments: MattersComment[],
  donations: MattersDonation[],
  appreciations: MattersAppreciation[],
  commentCount?: number
): MattersSocialData {
  // Get or create article entry
  const existing = data.articles[articleKey] || createEmptyArticleSocialData();

  // Merge each type
  data.articles[articleKey] = {
    comments: mergeComments(existing.comments, comments),
    donations: mergeDonations(existing.donations, donations),
    appreciations: mergeAppreciations(existing.appreciations, appreciations),
    lastKnownCommentCount:
      commentCount !== undefined ? commentCount : existing.lastKnownCommentCount,
  };

  return data;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get social data for a specific article
 */
export function getArticleSocialData(
  data: MattersSocialData,
  articleKey: string
): ArticleSocialData | undefined {
  return data.articles[articleKey];
}

/**
 * Get total counts for an article's social interactions
 */
export function getSocialCounts(
  data: MattersSocialData,
  articleKey: string
): { comments: number; donations: number; appreciations: number; totalClaps: number } {
  const articleData = data.articles[articleKey];

  if (!articleData) {
    return { comments: 0, donations: 0, appreciations: 0, totalClaps: 0 };
  }

  const totalClaps = articleData.appreciations.reduce(
    (sum, a) => sum + a.amount,
    0
  );

  return {
    comments: articleData.comments.length,
    donations: articleData.donations.length,
    appreciations: articleData.appreciations.length,
    totalClaps,
  };
}
