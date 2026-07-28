/**
 * Asset download functionality with incremental file updates
 *
 * DESIGN PRINCIPLE: Write files incrementally, not in a batch at the end.
 *
 * This ensures:
 * 1. If interrupted, completed files are already saved
 * 2. Running again skips already-updated files (self-correcting)
 * 3. No "Phase 3" batch write that can silently fail
 */

import {
  reportError,
  sleep,
} from "./utils";
import { overallProgress, type ProgressReporter } from "./progress";
import { downloadAsset as downloadAssetRust } from "@symbiosis-lab/moss-api";
import { extractRemoteImageUrls, extractMarkdownLinks } from "./converter";
import { isInternalMattersLink as isDomainInternalLink, extractShortHash } from "./domain";
import { listFiles, readFile, writeFile } from "@symbiosis-lab/moss-api";
import {
  loadFailedMediaMemo,
  mergePermanentFailures,
  type FailedMediaEntry,
} from "./failed-media";

// ============================================================================
// Constants
// ============================================================================

const MAX_RETRIES = 3;
// Note: Concurrency is now handled by Rust-side Semaphore (DOWNLOAD_CONCURRENCY_LIMIT=5)
// Timeout is handled by Rust-side tokio::time::timeout (default 30s)

// ============================================================================
// Pure Helper Functions (exported for testing)
// ============================================================================

/**
 * Extract UUID from a URL (Matters asset IDs are UUIDs)
 * Handles URLs from both assets.matters.news and imagedelivery.net
 */
export function extractAssetUuid(url: string): string | null {
  const match = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  return match ? match[1] : null;
}

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a regex pattern that matches any URL containing the given asset ID
 * Used for updating references when the same asset has multiple CDN URLs
 */
export function buildAssetUrlPattern(assetId: string): RegExp {
  return new RegExp(
    `https?://[^)\\s"]*${escapeRegex(assetId)}[^)\\s"]*`,
    'g'
  );
}

/**
 * Replace all URLs containing the asset ID with a local path
 * Returns the modified content and whether any replacements were made
 */
export function replaceAssetUrls(
  content: string,
  assetId: string,
  localPath: string
): { content: string; replaced: boolean } {
  const pattern = buildAssetUrlPattern(assetId);
  const hasMatch = pattern.test(content);

  if (!hasMatch) {
    return { content, replaced: false };
  }

  // Reset regex lastIndex after test() call
  pattern.lastIndex = 0;
  const newContent = content.replace(pattern, localPath);
  return { content: newContent, replaced: true };
}

/**
 * Replace a full markdown image token `![alt](url)` whose URL contains the
 * asset id with a filename-only wikilink `![[filename]]` (B2).
 *
 * Unlike `replaceAssetUrls` — which swaps only the URL substring and leaves the
 * `![alt](...)` wrapper plus a depth-dependent relative path (`../assets/…` vs
 * `../../assets/…`) — this replaces the ENTIRE image token so moss's shared
 * filename-stem asset resolver (`resolve::asset_class::resolve_asset_ref`)
 * resolves it from ANY article depth with no `../` chains. The basename carries
 * the real extension, so the extensionless-ref bug (B8) disappears too. Alt
 * text is dropped to match moss/Obsidian `![[file]]` embed syntax.
 */
export function replaceImageWithWikilink(
  content: string,
  assetId: string,
  filename: string
): { content: string; replaced: boolean } {
  // `!\[[^\]]*\]` = the `![alt]` part (alt may be empty); then `(url[ "title"])`
  // where the url contains the asset id. The optional ` "title"` trailer matches
  // htmd's `![alt](url "title")` output for <img title=...> (else the CDN URL
  // would be left in the body — an orphaned-asset / broken-image leak).
  const pattern = new RegExp(
    `!\\[[^\\]]*\\]\\(https?://[^)\\s"]*${escapeRegex(assetId)}[^)\\s"]*(?:\\s+"[^"]*")?\\)`,
    'g'
  );
  if (!pattern.test(content)) {
    return { content, replaced: false };
  }
  pattern.lastIndex = 0;
  const newContent = content.replace(pattern, `![[${filename}]]`);
  return { content: newContent, replaced: true };
}

/**
 * Replace a full markdown image token whose URL is the EXACT given URL with a
 * filename-only wikilink `![[filename]]` (B6 — legacy non-UUID CDN assets).
 *
 * `replaceImageWithWikilink` keys on a Matters asset UUID; legacy cloudfront
 * images (e.g. `assets.matters.news/.../image.jpg` with no UUID segment) have
 * no UUID to key on, so their references were never rewritten — the dead remote
 * CDN URL leaked into the published body. This matches on the literal URL
 * instead, so a downloaded legacy asset still localizes. The optional ` "title"`
 * trailer matches htmd's `![alt](url "title")` output.
 */
export function replaceImageUrlWithWikilink(
  content: string,
  url: string,
  filename: string
): { content: string; replaced: boolean } {
  const pattern = new RegExp(
    `!\\[[^\\]]*\\]\\(${escapeRegex(url)}(?:\\s+"[^"]*")?\\)`,
    'g'
  );
  if (!pattern.test(content)) {
    return { content, replaced: false };
  }
  pattern.lastIndex = 0;
  const newContent = content.replace(pattern, `![[${filename}]]`);
  return { content: newContent, replaced: true };
}

// ============================================================================
// Fibonacci Backoff
// ============================================================================

/**
 * Get delay for retry attempt using Fibonacci sequence
 * Returns delay in milliseconds: 1000, 1000, 2000, 3000, 5000, 8000, 13000, 21000...
 */
function getFibonacciDelay(attempt: number): number {
  if (attempt <= 2) return 1000;
  let a = 1, b = 1;
  for (let i = 2; i < attempt; i++) {
    [a, b] = [b, a + b];
  }
  return b * 1000;
}

/**
 * Check if an HTTP status code is retryable (transient error)
 * 408 = Request Timeout, 429 = Too Many Requests, 5xx = Server errors
 */
function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

// ============================================================================
// Asset Download
// ============================================================================

/** Error with HTTP status for retry classification */
class DownloadError extends Error {
  constructor(message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "DownloadError";
  }

  /** Check if this error is retryable (transient) */
  isRetryable(): boolean {
    // Network errors (no status) are retryable
    if (this.httpStatus === undefined) return true;
    return isRetryableHttpStatus(this.httpStatus);
  }
}

/**
 * Download a single asset with retry logic and comprehensive logging.
 * Uses Rust to download and save directly to disk (avoids JS base64 blocking).
 * moss handles filename derivation and extension from content-type.
 *
 * Timeout and concurrency are handled by Rust side:
 * - Semaphore limits concurrent downloads to 5
 * - tokio::time::timeout enforces 30s cumulative timeout
 *
 * Logging:
 * - [↓] Attempt N/M: Starting download attempt
 * - [✓] Downloaded: Successful download
 * - [!] HTTP {status}: HTTP error (retryable or final)
 * - [✗] TIMEOUT: Download timeout from Rust
 * - [✗] ERROR: Other errors (network, etc.)
 * - [↻] Retrying: Retry announcement with delay
 * - [✗] FAILED: Final failure after all retries
 */
async function downloadAssetWithRetry(
  url: string
): Promise<{ actualPath: string; success: boolean; error?: string; permanent?: boolean }> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`   [↓] Attempt ${attempt}/${MAX_RETRIES}: ${url}`);

      // Rust handles timeout (30s) and concurrency (5 parallel)
      const result = await downloadAssetRust(url, "assets");

      if (!result.ok) {
        const err = new DownloadError(`HTTP ${result.status}`, result.status);
        console.warn(`   [!] HTTP ${result.status} for ${url}`);

        const retryable = err.isRetryable();
        if (!retryable || attempt === MAX_RETRIES) {
          const isPermanent = !retryable;
          console.error(`   [✗] FAILED after ${attempt} attempts: ${url} - HTTP ${result.status}${isPermanent ? " (permanent)" : ""}`);
          return { actualPath: "", success: false, error: `HTTP ${result.status}`, permanent: isPermanent };
        }

        const delay = getFibonacciDelay(attempt);
        console.warn(`   [↻] Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }

      console.log(`   [✓] Downloaded: ${result.actualPath}`);
      return { actualPath: result.actualPath, success: true };

    } catch (fetchError: unknown) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      const isTimeout = message.toLowerCase().includes("timeout");

      // Log the error type
      if (isTimeout) {
        console.error(`   [✗] TIMEOUT: ${url} - ${message}`);
      } else {
        console.error(`   [✗] ERROR: ${url} - ${message}`);
      }

      if (attempt === MAX_RETRIES) {
        console.error(`   [✗] FAILED after ${MAX_RETRIES} attempts: ${url}`);
        // Network/timeout errors (no HTTP status) are not permanent — the server
        // may be transiently unreachable. Only non-retryable HTTP statuses are
        // permanent.
        return { actualPath: "", success: false, error: message, permanent: false };
      }

      const delay = getFibonacciDelay(attempt);
      console.warn(`   [↻] Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(delay);
    }
  }

  console.error(`   [✗] FAILED after ${MAX_RETRIES} attempts: ${url}`);
  return { actualPath: "", success: false, error: "Max retries exceeded", permanent: false };
}

// ============================================================================
// Types
// ============================================================================

/** Media URL found in a file */
interface MediaUrl {
  url: string;
  uuid: string | null;
  inBody: boolean;
  inCover: boolean;
}

/** File state for processing */
interface FileState {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  mediaUrls: MediaUrl[];
}

// ============================================================================
// Main Function: downloadMediaAndUpdate
// ============================================================================

/**
 * Download all media for all markdown files in a project and update references.
 *
 * DESIGN: Fire all downloads in parallel, let Rust handle concurrency.
 *
 * 1. **Parallel downloads**: All downloads start immediately via Promise.allSettled
 * 2. **Rust-side concurrency**: Semaphore limits to 5 concurrent downloads
 * 3. **Rust-side timeout**: tokio::time::timeout enforces 30s cumulative timeout
 * 4. **Self-correcting**: Running again skips already-downloaded assets (by UUID)
 *
 * Flow:
 * 1. Scan all files to collect unique media URLs needing download
 * 2. Fire all downloads in parallel (Rust handles concurrency/timeout)
 * 3. After all complete, update references in each file
 * 4. Write modified files to disk
 */
export async function downloadMediaAndUpdate(
  onProgress?: ProgressReporter,
): Promise<{
  filesProcessed: number;
  imagesDownloaded: number;
  imagesSkipped: number;
  errors: string[];
  /**
   * Source URLs of images that failed to download (the dead CDN references
   * still sitting in the article bodies). Populated for observability and
   * tests; the caller no longer acts on it. Permanent failures are persisted
   * to failed-media.json and surfaced in the Matters settings page (the
   * per-image advisory was removed — dead URLs are non-actionable and
   * repetitive). A subset of `errors` carrying just the image-download
   * failures (not list/write failures).
   */
  failedImageUrls: string[];
}> {
  const result = {
    filesProcessed: 0,
    imagesDownloaded: 0,
    imagesSkipped: 0,
    errors: [] as string[],
    failedImageUrls: [] as string[],
  };

  console.log("📸 Downloading media assets and updating references...");

  // Get all project files once
  let allProjectFiles: string[];
  try {
    allProjectFiles = await listFiles();
  } catch (err) {
    console.error(`Failed to list project files: ${err}`);
    result.errors.push(`Failed to list files: ${err}`);
    return result;
  }

  const allMdFiles = allProjectFiles.filter(f => f.endsWith(".md"));
  console.log(`   Found ${allMdFiles.length} markdown files`);

  // Build UUID→asset path mapping for existing assets
  // This allows us to skip downloads when assets already exist
  const existingAssetsByUuid = new Map<string, string>();
  for (const assetPath of allProjectFiles.filter(f => f.startsWith("assets/"))) {
    const uuid = extractAssetUuid(assetPath);
    if (uuid) {
      existingAssetsByUuid.set(uuid, assetPath);
    }
  }
  console.log(`   Found ${existingAssetsByUuid.size} existing assets`);

  const { parseFrontmatter, regenerateFrontmatter } = await import("./converter");

  // ========================================================================
  // Phase 1: Scan files to find those with remote media
  // ========================================================================

  const filesToProcess: FileState[] = [];

  for (const filePath of allMdFiles) {
    try {
      const content = await readFile(filePath);
      const parsed = parseFrontmatter(content);
      if (!parsed) continue;

      const mediaUrls: MediaUrl[] = [];

      // Extract body media
      const bodyMedia = extractRemoteImageUrls(parsed.body);
      for (const media of bodyMedia) {
        mediaUrls.push({
          url: media.url,
          uuid: extractAssetUuid(media.url),
          inBody: true,
          inCover: false,
        });
      }

      // Extract cover media
      const cover = parsed.frontmatter.cover;
      if (typeof cover === "string" && (cover.startsWith("http://") || cover.startsWith("https://"))) {
        mediaUrls.push({
          url: cover,
          uuid: extractAssetUuid(cover),
          inBody: false,
          inCover: true,
        });
      }

      // Skip files with no remote media
      if (mediaUrls.length === 0) continue;

      filesToProcess.push({
        path: filePath,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        mediaUrls,
      });
    } catch {
      // Skip files that can't be read
    }
  }

  console.log(`   Found ${filesToProcess.length} files with remote media`);

  if (filesToProcess.length === 0) {
    return result;
  }

  // Count total unique URLs (for progress reporting)
  const allUuids = new Set<string>();
  let totalUrls = 0;
  for (const file of filesToProcess) {
    for (const media of file.mediaUrls) {
      if (media.uuid) {
        if (!allUuids.has(media.uuid)) {
          allUuids.add(media.uuid);
          totalUrls++;
        }
      } else {
        totalUrls++;
      }
    }
  }
  console.log(`   Total unique media URLs: ${totalUrls}`);

  // ========================================================================
  // Phase 2: Download all images in parallel (Rust handles concurrency)
  // ========================================================================

  // Load the permanent-failure memo once. URLs in this set returned a
  // non-retryable HTTP status on a prior build and will never succeed — skip
  // them immediately without any network attempt.
  const permFailedMemo = await loadFailedMediaMemo();
  const permFailed = new Set(permFailedMemo.map((e) => e.url));

  // Build a url → filePaths map for the permanent-failure record. A single
  // dead URL can be referenced by MULTIPLE articles, so collect every file
  // that references it (deduped per-url).
  const urlToFilePaths = new Map<string, string[]>();
  for (const file of filesToProcess) {
    for (const media of file.mediaUrls) {
      const paths = urlToFilePaths.get(media.url);
      if (paths) {
        if (!paths.includes(file.path)) paths.push(file.path);
      } else {
        urlToFilePaths.set(media.url, [file.path]);
      }
    }
  }

  // Collect all unique media that needs downloading (not already in existing assets)
  const mediaToDownload: { url: string; uuid: string | null }[] = [];
  const seenUuids = new Set<string>();

  for (const file of filesToProcess) {
    for (const media of file.mediaUrls) {
      // Skip if already downloaded in this batch
      if (media.uuid && seenUuids.has(media.uuid)) continue;

      // Skip if asset already exists
      if (media.uuid && existingAssetsByUuid.has(media.uuid)) {
        result.imagesSkipped++;
        continue;
      }

      // Skip permanently-failed URLs — they will never succeed and do not need
      // another network attempt. Count as skipped (not as errors).
      if (permFailed.has(media.url)) {
        result.imagesSkipped++;
        continue;
      }

      mediaToDownload.push({ url: media.url, uuid: media.uuid });
      if (media.uuid) seenUuids.add(media.uuid);
    }
  }

  console.log(`   Downloading ${mediaToDownload.length} media files (${result.imagesSkipped} skipped)...`);

  // Fire all downloads in parallel - Rust Semaphore limits to 5 concurrent
  // Promise.allSettled ensures we get results for all, even if some fail
  let completedCount = 0;
  const downloadPromises = mediaToDownload.map(async (media) => {
    const downloadResult = await downloadAssetWithRetry(media.url);

    // Report progress as each download COMPLETES. Count completions (single-
    // threaded `++` in the continuation is atomic), NOT the creation index —
    // downloads finish out of order, so an index-based fraction would jump the
    // hairline forward then back. media download is the heaviest phase
    // (weight 35/100); feeding the unified task here keeps the hairline
    // advancing monotonically instead of stalling through it.
    completedCount++;
    onProgress?.(
      "downloading_media",
      overallProgress("downloading_media", completedCount, mediaToDownload.length),
      100,
      `Downloading ${completedCount}/${mediaToDownload.length}...`
    );

    return { media, downloadResult };
  });

  const downloadResults = await Promise.allSettled(downloadPromises);

  // Build uuid → localPath map from successful downloads. Also key by the
  // literal URL so legacy non-UUID assets (no UUID to key on) can still be
  // localized in Phase 3 (B6).
  const downloadedUuids = new Map<string, string>();
  const downloadedByUrl = new Map<string, string>();

  // Permanent failures to persist after Phase 3.
  const permanentFailures: FailedMediaEntry[] = [];

  for (const settled of downloadResults) {
    if (settled.status === "fulfilled") {
      const { media, downloadResult } = settled.value;
      if (downloadResult.success) {
        result.imagesDownloaded++;
        downloadedByUrl.set(media.url, downloadResult.actualPath);
        // Track by UUID for dedup and reference updates
        if (media.uuid) {
          downloadedUuids.set(media.uuid, downloadResult.actualPath);
          existingAssetsByUuid.set(media.uuid, downloadResult.actualPath);
        }
      } else {
        // Surface the failure as a user-visible diagnostic (not just a count +
        // a console line). A failed download leaves the dead CDN URL in the
        // body, so the user needs to know which image broke (B6). Non-fatal:
        // sync continues, partial success is allowed.
        const msg = `Image download failed (${downloadResult.error}): ${media.url}`;
        result.errors.push(`${media.url}: ${downloadResult.error}`);
        result.failedImageUrls.push(media.url);
        await reportError(msg, "downloading_media", false);

        // If the failure is permanent (non-retryable HTTP status such as 403 /
        // 404 / 410), record it so future builds skip the URL entirely.
        if (downloadResult.permanent) {
          permanentFailures.push({
            url: media.url,
            filePaths: urlToFilePaths.get(media.url) ?? [],
            failedAt: new Date().toISOString(),
          });
        }
      }
    } else {
      // Promise rejected (shouldn't happen with our try/catch in
      // downloadAssetWithRetry). No `media.url` is available here, so this stays
      // in `errors` only — it is intentionally NOT pushed to `failedImageUrls`,
      // whose entries must be real image URLs for the per-image advisory.
      const msg = `Image download failed: ${settled.reason}`;
      result.errors.push(`Download failed: ${settled.reason}`);
      await reportError(msg, "downloading_media", false);
    }
  }

  console.log(`   Downloaded ${result.imagesDownloaded}/${mediaToDownload.length} media files`);

  // ========================================================================
  // Phase 3: Update references in files
  // ========================================================================

  for (let fileIndex = 0; fileIndex < filesToProcess.length; fileIndex++) {
    const file = filesToProcess[fileIndex];
    let modified = false;
    let { frontmatter, body } = file;

    // Deduplicate URLs within this file by UUID, merging inBody/inCover flags
    const mediaByKey = new Map<string, MediaUrl>();
    for (const media of file.mediaUrls) {
      const key = media.uuid || media.url;
      const existing = mediaByKey.get(key);
      if (existing) {
        existing.inBody = existing.inBody || media.inBody;
        existing.inCover = existing.inCover || media.inCover;
      } else {
        mediaByKey.set(key, { ...media });
      }
    }
    const uniqueMedia = Array.from(mediaByKey.values());

    // Update references for each media
    for (const media of uniqueMedia) {
      // Resolve the downloaded/existing local path. UUID assets key on UUID;
      // legacy non-UUID CDN assets (no UUID segment) key on the literal URL
      // (B6) — previously these were skipped (`if (!media.uuid) continue;`)
      // and their dead CDN URL leaked into the published body.
      const localPath = media.uuid
        ? (downloadedUuids.get(media.uuid) || existingAssetsByUuid.get(media.uuid))
        : downloadedByUrl.get(media.url);
      if (!localPath) continue;

      // Emit a filename-only wikilink (B2/B8): depth-independent, resolved by
      // moss's shared filename-stem asset resolver from any article depth — no
      // `../` chains. The basename carries the real extension. Replaces the
      // prior depth-dependent `calculateRelativePath` + URL-substring rewrite.
      const filename = localPath.split('/').pop() || localPath;

      // Update body references → `![[filename]]`. UUID assets match any CDN URL
      // carrying the UUID; non-UUID assets match the exact URL.
      if (media.inBody) {
        const { content: newBody, replaced } = media.uuid
          ? replaceImageWithWikilink(body, media.uuid, filename)
          : replaceImageUrlWithWikilink(body, media.url, filename);
        if (replaced) {
          body = newBody;
          modified = true;
        }
      }

      // Update cover reference → bare filename (frontmatter; resolver finds it).
      if (media.inCover) {
        const coverStr = String(frontmatter.cover || '');
        const coverMatches = media.uuid
          ? coverStr.includes(media.uuid)
          : coverStr === media.url;
        if (coverMatches) {
          frontmatter = { ...frontmatter, cover: filename };
          modified = true;
        }
      }
    }

    // Write file if modified
    if (modified) {
      try {
        const newContent = regenerateFrontmatter(frontmatter) + "\n" + body;
        await writeFile(file.path, newContent);
        result.filesProcessed++;
        console.log(`   [📝] Wrote: ${file.path}`);
      } catch (err) {
        result.errors.push(`Failed to write ${file.path}: ${err}`);
        console.error(`   [✗] Failed to write: ${file.path} - ${err}`);
      }
    }
  }

  // Persist any new permanent failures so future builds skip them.
  // Must run after Phase 3 (file writes) but before returning — we want the
  // memo on disk even if Phase 3 had no changes.
  if (permanentFailures.length > 0) {
    await mergePermanentFailures(permanentFailures);
  }

  // Final report. Snap the band to 100% using `totalUrls` (ALL unique media,
  // including already-cached ones) — NOT `mediaToDownload.length`, which is 0
  // when everything was cached and would jump progress BACK to the band start.
  onProgress?.(
    "downloading_media",
    overallProgress("downloading_media", totalUrls, totalUrls),
    100,
    `Downloaded ${result.imagesDownloaded} media, updated ${result.filesProcessed} files`
  );

  console.log(`   ✅ Downloaded ${result.imagesDownloaded}, skipped ${result.imagesSkipped}, updated ${result.filesProcessed} files`);

  return result;
}

// ============================================================================
// Internal Link Rewriting
// ============================================================================

/**
 * Check if a URL points to current user's Matters content
 */
function isInternalMattersLink(url: string, userName: string): boolean {
  return isDomainInternalLink(url, userName);
}

/**
 * Rewrite internal Matters links to local paths in a single file's content
 */
function rewriteLinksInContent(
  content: string,
  articlePathMap: Map<string, string>,
  userName: string,
  currentFilePath: string
): { content: string; linksRewritten: number } {
  const links = extractMarkdownLinks(content);
  let modifiedContent = content;
  let linksRewritten = 0;

  for (const { url, fullMatch } of links) {
    // Only own-user canonical `/@userName/...` links are rewritten. `/a/<shortHash>`
    // short-links never pass this guard, so the shared extractShortHash's short-link
    // support is intentionally unreachable here — body cross-links are canonical form.
    if (!isInternalMattersLink(url, userName)) continue;

    // Try exact URL match first
    let localPath = articlePathMap.get(url);

    // If not found, try shortHash match
    if (!localPath) {
      const shortHash = extractShortHash(url);
      if (shortHash) {
        localPath = articlePathMap.get(shortHash);
      }
    }

    if (localPath) {
      // Calculate relative path from current file to target file
      const relativePath = calculateRelativePath(currentFilePath, localPath);
      const newLink = fullMatch.replace(url, relativePath);
      modifiedContent = modifiedContent.replace(fullMatch, newLink);
      linksRewritten++;
    }
  }

  return { content: modifiedContent, linksRewritten };
}

/**
 * Calculate relative path from one file to another
 * e.g., from "article/collection/post.md" to "article/other.md" → "../other.md"
 */
export function calculateRelativePath(fromPath: string, toPath: string): string {
  const fromParts = fromPath.split("/").slice(0, -1); // Remove filename, keep directory
  const toParts = toPath.split("/");

  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length - 1 &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  // Build relative path
  const upCount = fromParts.length - commonLength;
  const upPath = "../".repeat(upCount);
  const downPath = toParts.slice(commonLength).join("/");

  return upPath + downPath || toPath;
}

/**
 * Rewrite internal Matters links to local paths across all markdown files
 * This is a fast operation (string manipulation only, no network I/O)
 *
 * Should be run AFTER downloadMediaAndUpdate() to avoid overwriting image refs.
 */
export async function rewriteAllInternalLinks(
  articlePathMap: Map<string, string>,
  userName: string
): Promise<{
  filesProcessed: number;
  linksRewritten: number;
  errors: string[];
}> {
  const result = {
    filesProcessed: 0,
    linksRewritten: 0,
    errors: [] as string[],
  };

  if (articlePathMap.size === 0) {
    console.log("🔗 No articles to rewrite links for");
    return result;
  }

  console.log("🔗 Rewriting internal Matters links...");

  let allFiles: string[];
  try {
    const allProjectFiles = await listFiles();
    allFiles = allProjectFiles.filter((f: string) => f.endsWith(".md"));
  } catch (err) {
    console.error(`Failed to list project files: ${err}`);
    result.errors.push(`Failed to list files: ${err}`);
    return result;
  }

  console.log(`   Scanning ${allFiles.length} markdown files for internal links...`);

  // Import parseFrontmatter dynamically to avoid circular dependency
  const { parseFrontmatter, regenerateFrontmatter } = await import("./converter");

  for (const file of allFiles) {
    try {
      const content = await readFile(file);

      const parsed = parseFrontmatter(content);
      if (!parsed) continue;

      const { content: modifiedBody, linksRewritten } = rewriteLinksInContent(
        parsed.body,
        articlePathMap,
        userName,
        file
      );

      if (linksRewritten > 0) {
        const newContent = regenerateFrontmatter(parsed.frontmatter) + "\n" + modifiedBody;

        await writeFile(file, newContent);

        result.filesProcessed++;
        result.linksRewritten += linksRewritten;
      }
    } catch (err) {
      result.errors.push(`Failed to process ${file}: ${err}`);
    }
  }

  console.log(`   Rewrote ${result.linksRewritten} links in ${result.filesProcessed} files`);

  return result;
}
