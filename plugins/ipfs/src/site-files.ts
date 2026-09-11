/**
 * Read the built site into memory as base64, ready for upload.
 *
 * Reads EXACTLY the paths moss handed the deploy hook (context.site_files) so
 * the validated list and the uploaded list can never diverge. Sizes are derived
 * from the base64 payload itself. Reads run with bounded concurrency to avoid
 * paying one serial webview→Rust round-trip per file.
 */

import { readSiteFile } from "@symbiosis-lab/moss-api";
import type { SiteFile, UploadProgress } from "./types";
import { PER_FILE_WARN_BYTES, TOTAL_WARN_BYTES } from "./constants";
import { formatBytes } from "./utils";

/** Concurrent readSiteFile calls in flight at once. */
const READ_CONCURRENCY = 8;

export interface SiteReadResult {
  files: SiteFile[];
  totalBytes: number;
  /** Non-fatal warnings (e.g. very large files) to surface via toast/log. */
  warnings: string[];
}

/** Normalize to forward-slash separators for stable multipart filenames. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

/** Decoded byte size of a base64 string (accounts for padding). */
export function sizeFromBase64(base64: string): number {
  const len = base64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (base64.endsWith("==")) padding = 2;
  else if (base64.endsWith("=")) padding = 1;
  return (len * 3) / 4 - padding;
}

/**
 * Read every built-site file as base64, preserving input order.
 *
 * @param sitePaths paths from context.site_files (the authoritative list).
 * @param onProgress optional 0–100 progress callback for the read phase.
 * @throws if the list is empty (caller should have validated site_files).
 */
export async function readSiteFiles(
  sitePaths: string[],
  onProgress?: UploadProgress,
): Promise<SiteReadResult> {
  if (sitePaths.length === 0) {
    throw new Error("Site directory is empty. Please build your site first.");
  }

  const files: SiteFile[] = new Array(sitePaths.length);
  let done = 0;

  for (let start = 0; start < sitePaths.length; start += READ_CONCURRENCY) {
    const batch = sitePaths.slice(start, start + READ_CONCURRENCY);
    await Promise.all(
      batch.map(async (rawPath, offset) => {
        const base64 = await readSiteFile(rawPath);
        files[start + offset] = {
          path: normalizePath(rawPath),
          base64,
          size: sizeFromBase64(base64),
        };
        done++;
        if (onProgress) {
          onProgress(
            Math.round((done / sitePaths.length) * 100),
            `Reading ${normalizePath(rawPath)}`,
          );
        }
      }),
    );
  }

  const warnings: string[] = [];
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += f.size;
    if (f.size > PER_FILE_WARN_BYTES) {
      warnings.push(`${f.path} is large (${formatBytes(f.size)}).`);
    }
  }
  if (totalBytes > TOTAL_WARN_BYTES) {
    warnings.push(
      `Total site size is ${formatBytes(totalBytes)}; large uploads may be slow.`,
    );
  }

  return { files, totalBytes, warnings };
}
