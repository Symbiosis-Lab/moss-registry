/**
 * Content conversion utilities: frontmatter handling + image/link extraction.
 *
 * NOTE: HTML→Markdown is NOT done here. Production converts via moss's shared
 * Rust `htmd` converter, imported as `htmlToMarkdown` from `@symbiosis-lab/moss-api`
 * (see `sync.ts`). The hand-rolled DOM-walking converter that used to live here
 * was deleted (B4) — it duplicated functionality moss already owns and shipped
 * the lone-backslash `<br>` bug (B3).
 */

import type { FrontmatterData, ParsedFrontmatter } from "./types";

// ============================================================================
// Frontmatter Handling
// ============================================================================

/**
 * Escape string for YAML (escape backslashes first, then quotes)
 */
function escapeYaml(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Generate frontmatter YAML from data object
 */
export function generateFrontmatter(data: FrontmatterData): string {
  const lines: string[] = ["---"];

  lines.push(`title: "${escapeYaml(data.title)}"`);

  if (data.home) {
    lines.push("home: true");
  }

  if (data.description) {
    lines.push(`description: "${escapeYaml(data.description)}"`);
  }

  if (data.date) {
    lines.push(`date: "${data.date}"`);
  }
  if (data.updated) {
    lines.push(`updated: "${data.updated}"`);
  }

  if (data.tags && data.tags.length > 0) {
    lines.push("tags:");
    for (const tag of data.tags) {
      lines.push(`  - "${escapeYaml(tag)}"`);
    }
  }

  if (data.cover) {
    lines.push(`cover: "${data.cover}"`);
  }

  if (data.syndicated && data.syndicated.length > 0) {
    lines.push("syndicated:");
    for (const url of data.syndicated) {
      lines.push(`  - "${url}"`);
    }
  }

  if (data.collections) {
    if (Array.isArray(data.collections)) {
      // Array format: collections as list of slugs
      if (data.collections.length > 0) {
        lines.push("collections:");
        for (const slug of data.collections) {
          lines.push(`  - "${slug}"`);
        }
      }
    } else if (Object.keys(data.collections).length > 0) {
      // Object format: collections with order numbers
      lines.push("collections:");
      for (const [slug, order] of Object.entries(data.collections)) {
        lines.push(`  ${slug}: ${order}`);
      }
    }
  }

  if (data.order && data.order.length > 0) {
    lines.push("order:");
    for (const filename of data.order) {
      lines.push(`  - "${filename}"`);
    }
  }

  lines.push("---");

  return lines.join("\n");
}

/**
 * Parse frontmatter from markdown content
 */
export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const frontmatterStr = match[1];
  const body = match[2];

  const frontmatter: Record<string, unknown> = {};
  const lines = frontmatterStr.split("\n");
  let currentKey = "";
  let currentArray: string[] = [];

  // Strip a surrounding quote pair. Double-quoted per the plugin's own
  // emission; single-quoted per serde_yaml's normalized form (moss's uid
  // stamping and editor round-trips rewrite every synced file with it, and it
  // single-quotes any scalar that would otherwise read as number/bool). YAML
  // escapes ' as '' inside single-quoted style, so unescape those.
  const unquote = (raw: string): string => {
    const dq = raw.match(/^"(.*)"$/);
    if (dq) return dq[1];
    const sq = raw.match(/^'(.*)'$/);
    if (sq) return sq[1].replace(/''/g, "'");
    return raw;
  };

  for (const line of lines) {
    // Accept both the plugin's `  - "item"` and serde_yaml's `- item` forms.
    const listItem = line.match(/^( {2})?- (.*)$/);
    if (listItem) {
      currentArray.push(unquote(listItem[2].trim()));
    } else if (line.includes(":")) {
      // Save previous array if any
      if (currentKey && currentArray.length > 0) {
        frontmatter[currentKey] = currentArray;
        currentArray = [];
      }

      const colonIndex = line.indexOf(":");
      const key = line.substring(0, colonIndex);
      const rest = line.substring(colonIndex + 1).trim();

      if (rest === "") {
        // Array or object key (e.g., "tags:")
        currentKey = key;
        currentArray = [];
      } else {
        // Simple key-value pair
        currentKey = "";
        frontmatter[key] = unquote(rest);
      }
    }
  }

  // Save last array if any
  if (currentKey && currentArray.length > 0) {
    frontmatter[currentKey] = currentArray;
  }

  return { frontmatter, body };
}

/**
 * Regenerate frontmatter YAML from parsed object
 */
export function regenerateFrontmatter(frontmatter: Record<string, unknown>): string {
  const lines: string[] = ["---"];

  const formatValue = (value: unknown): string => {
    if (typeof value === "string") {
      if (value.includes(":") || value.includes("#") || value.includes('"') || value.startsWith(" ")) {
        return `"${escapeYaml(value)}"`;
      }
      return `"${value}"`;
    }
    return String(value);
  };

  const fieldOrder = ["title", "description", "date", "updated", "tags", "cover", "syndicated", "collections", "order"];

  for (const key of fieldOrder) {
    if (!(key in frontmatter)) continue;
    const value = frontmatter[key];

    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${formatValue(item)}`);
      }
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${key}:`);
      for (const [subKey, subValue] of Object.entries(value)) {
        lines.push(`  ${subKey}: ${subValue}`);
      }
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${formatValue(value)}`);
    }
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    if (fieldOrder.includes(key)) continue;

    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${formatValue(item)}`);
      }
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${key}:`);
      for (const [subKey, subValue] of Object.entries(value)) {
        lines.push(`  ${subKey}: ${subValue}`);
      }
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${formatValue(value)}`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}

/**
 * Extract all markdown links from content (not images)
 * Used for detecting internal Matters links that need rewriting
 */
export function extractMarkdownLinks(content: string): Array<{
  url: string;
  fullMatch: string;
}> {
  const results: Array<{ url: string; fullMatch: string }> = [];
  // Match markdown links [text](url) but NOT images ![alt](url)
  // Negative lookbehind (?<!!") ensures we don't match image syntax
  const linkPattern = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
  let match;

  while ((match = linkPattern.exec(content)) !== null) {
    results.push({
      fullMatch: match[0],
      url: match[2].trim(),
    });
  }

  return results;
}

/**
 * Extract remote image URLs from markdown content
 */
export function extractRemoteImageUrls(
  content: string
): Array<{ url: string; localFilename: string }> {
  const results: Array<{ url: string; localFilename: string }> = [];
  const seen = new Set<string>();

  const imagePattern = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;

  while ((match = imagePattern.exec(content)) !== null) {
    const url = match[1].trim();

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      continue;
    }

    if (seen.has(url)) {
      continue;
    }
    seen.add(url);

    const localFilename = generateLocalFilenameFromUrl(url);
    if (localFilename) {
      results.push({ url, localFilename });
    }
  }

  return results;
}

/**
 * Generate local filename from URL (duplicated here to avoid circular dependency)
 */
function generateLocalFilenameFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const cleanPath = pathname.replace(/\/public$/, "");
    const segments = cleanPath.split("/").filter((s) => s.length > 0);

    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i];
      const extMatch = segment.match(/\.(\w+)$/);
      if (extMatch) {
        const ext = extMatch[1].toLowerCase();
        if (i > 0 && /^[a-f0-9-]{36}$/i.test(segments[i - 1])) {
          return `${segments[i - 1]}.${ext}`;
        }
        return segment;
      }
    }

    for (const segment of segments) {
      if (/^[a-f0-9-]{36}$/i.test(segment)) {
        return segment;
      }
    }

    // Simple hash fallback
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = ((hash << 5) - hash) + url.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  } catch {
    return null;
  }
}
