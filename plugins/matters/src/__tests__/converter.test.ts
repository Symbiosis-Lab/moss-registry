import { describe, it, expect } from "vitest";
import {
  generateFrontmatter,
  parseFrontmatter,
  regenerateFrontmatter,
  extractRemoteImageUrls,
  extractMarkdownLinks,
} from "../converter";

// NOTE: the `htmlToMarkdown` describe block was deleted with the hand-rolled
// converter (B4). Production HTML→Markdown now runs through moss's shared Rust
// `htmd` converter (imported from `@symbiosis-lab/moss-api`), so the old tests
// no longer have a unit under test. They also enshrined the lone-backslash
// `<br>` output (`line1\\\nline2`) — i.e. the exact B3 bug the project fixed —
// which would be false confidence to keep.

describe("generateFrontmatter", () => {
  it("generates basic frontmatter", () => {
    const result = generateFrontmatter({ title: "Test Title" });
    expect(result).toContain("---");
    expect(result).toContain('title: "Test Title"');
  });

  it("escapes quotes in title", () => {
    const result = generateFrontmatter({ title: 'Test "Quote"' });
    expect(result).toContain('title: "Test \\"Quote\\""');
  });

  it("includes date and updated", () => {
    const result = generateFrontmatter({
      title: "Test",
      date: "2024-01-01",
      updated: "2024-01-02",
    });
    expect(result).toContain('date: "2024-01-01"');
    expect(result).toContain('updated: "2024-01-02"');
  });

  it("includes tags array", () => {
    const result = generateFrontmatter({
      title: "Test",
      tags: ["tag1", "tag2"],
    });
    expect(result).toContain("tags:");
    expect(result).toContain('  - "tag1"');
    expect(result).toContain('  - "tag2"');
  });

  it("includes cover", () => {
    const result = generateFrontmatter({
      title: "Test",
      cover: "cover.jpg",
    });
    expect(result).toContain('cover: "cover.jpg"');
  });

  it("includes syndicated URLs", () => {
    const result = generateFrontmatter({
      title: "Test",
      syndicated: ["https://example.com/article"],
    });
    expect(result).toContain("syndicated:");
    expect(result).toContain('  - "https://example.com/article"');
  });

  it("includes collections mapping", () => {
    const result = generateFrontmatter({
      title: "Test",
      collections: { "my-collection": 0, "other-collection": 1 },
    });
    expect(result).toContain("collections:");
    expect(result).toContain("  my-collection: 0");
    expect(result).toContain("  other-collection: 1");
  });
});

describe("parseFrontmatter", () => {
  it("parses basic frontmatter", () => {
    const content = `---
title: "Test Title"
---
Body content`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.frontmatter.title).toBe("Test Title");
    expect(result?.body).toBe("Body content");
  });

  it("parses array values", () => {
    const content = `---
title: "Test"
tags:
  - "tag1"
  - "tag2"
---
Body`;
    const result = parseFrontmatter(content);
    expect(result?.frontmatter.tags).toEqual(["tag1", "tag2"]);
  });

  it("returns null for content without frontmatter", () => {
    const content = "Just some text without frontmatter";
    expect(parseFrontmatter(content)).toBeNull();
  });

  it("returns null for malformed frontmatter", () => {
    const content = `---
title: Test
No closing delimiter`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  it("handles empty body", () => {
    const content = `---
title: "Test"
---
`;
    const result = parseFrontmatter(content);
    expect(result?.body).toBe("");
  });

  // moss's build pipeline (uid stamping, editor round-trips) rewrites
  // frontmatter with serde_yaml, which emits UNINDENTED, unquoted list items
  // (`- item`, not `  - "item"`). Every synced vault ends up in this format,
  // and the whole identity system (article dedup by syndicated shortHash,
  // folder detection, collection markers) reads through this parser — so it
  // must accept both formats or renamed/stamped files become invisible.
  it("parses serde_yaml-normalized (moss-rewritten) frontmatter", () => {
    // Verbatim shape of a real uid-stamped article file
    const content = `---
uid: 46b110ee
tags:
- 互联网
- 區塊鏈
title: 下一代开放互联网
syndicated:
- https://matters.town/@guo/下一代开放互联网-vt5utvta7h49
---
Body`;
    const result = parseFrontmatter(content);
    expect(result?.frontmatter.syndicated).toEqual([
      "https://matters.town/@guo/下一代开放互联网-vt5utvta7h49",
    ]);
    expect(result?.frontmatter.tags).toEqual(["互联网", "區塊鏈"]);
    expect(result?.frontmatter.title).toBe("下一代开放互联网");
  });

  it("strips single quotes from unindented list items", () => {
    const content = `---
syndicated:
- 'https://matters.town/@guo/collections/Q29sbGVjdGlvbjo0ODQx'
---
Body`;
    const result = parseFrontmatter(content);
    expect(result?.frontmatter.syndicated).toEqual([
      "https://matters.town/@guo/collections/Q29sbGVjdGlvbjo0ODQx",
    ]);
  });

  it("strips single quotes from scalar values (serde_yaml quotes ambiguous scalars)", () => {
    // serde_yaml single-quotes scalars that would otherwise parse as
    // number/bool — e.g. an all-digit uid, or `is_collection: 'true'`
    const content = `---
uid: '46110234'
is_collection: 'true'
---
Body`;
    const result = parseFrontmatter(content);
    expect(result?.frontmatter.uid).toBe("46110234");
    expect(result?.frontmatter.is_collection).toBe("true");
  });

  it("unescapes doubled apostrophes inside single-quoted values", () => {
    // YAML single-quoted style escapes ' as '' — both scalars and list items
    const content = `---
title: 'it''s here'
tags:
- 'rock ''n'' roll'
---
Body`;
    const result = parseFrontmatter(content);
    expect(result?.frontmatter.title).toBe("it's here");
    expect(result?.frontmatter.tags).toEqual(["rock 'n' roll"]);
  });
});

describe("regenerateFrontmatter", () => {
  it("regenerates basic frontmatter", () => {
    const result = regenerateFrontmatter({ title: "Test" });
    expect(result).toContain("---");
    expect(result).toContain('title: "Test"');
  });

  it("preserves field order", () => {
    const result = regenerateFrontmatter({
      tags: ["a", "b"],
      title: "Test",
      date: "2024-01-01",
    });
    const lines = result.split("\n");
    const titleIndex = lines.findIndex((l) => l.includes("title:"));
    const dateIndex = lines.findIndex((l) => l.includes("date:"));
    const tagsIndex = lines.findIndex((l) => l === "tags:");
    expect(titleIndex).toBeLessThan(dateIndex);
    expect(dateIndex).toBeLessThan(tagsIndex);
  });

  it("handles nested objects", () => {
    const result = regenerateFrontmatter({
      collections: { "col-1": 0, "col-2": 1 },
    });
    expect(result).toContain("collections:");
    expect(result).toContain("  col-1: 0");
  });
});

describe("extractRemoteImageUrls", () => {
  it("extracts HTTP image URLs", () => {
    const content = "![alt](http://example.com/image.jpg)";
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("http://example.com/image.jpg");
  });

  it("extracts HTTPS image URLs", () => {
    const content = "![alt](https://example.com/image.png)";
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com/image.png");
  });

  it("ignores local image paths", () => {
    const content = "![alt](./images/local.jpg)";
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(0);
  });

  it("ignores relative paths", () => {
    const content = "![alt](assets/image.jpg)";
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(0);
  });

  it("deduplicates URLs", () => {
    const content = `
![img1](https://example.com/image.jpg)
![img2](https://example.com/image.jpg)
`;
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(1);
  });

  it("extracts multiple different URLs", () => {
    const content = `
![img1](https://example.com/image1.jpg)
![img2](https://example.com/image2.png)
`;
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(2);
  });

  it("generates local filenames", () => {
    const content = "![alt](https://cdn.example.com/uploads/photo.jpg)";
    const result = extractRemoteImageUrls(content);
    expect(result[0].localFilename).toBe("photo.jpg");
  });

  it("handles empty content", () => {
    const result = extractRemoteImageUrls("");
    expect(result).toHaveLength(0);
  });

  it("handles content with no images", () => {
    const content = "Just some text without images";
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(0);
  });
});

describe("extractMarkdownLinks", () => {
  it("extracts markdown links", () => {
    const content = "Check out [my link](https://example.com)";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com");
    expect(result[0].fullMatch).toBe("[my link](https://example.com)");
  });

  it("does NOT extract image syntax", () => {
    const content = "![alt text](https://example.com/image.jpg)";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(0);
  });

  it("extracts links but not images in mixed content", () => {
    const content = `
Here is a [link](https://example.com) and
an image ![image](https://example.com/img.png) and
another [second link](https://other.com).
`;
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe("https://example.com");
    expect(result[1].url).toBe("https://other.com");
  });

  it("extracts Matters.town article links", () => {
    const content = "Read my [previous article](https://matters.town/@alice/hello-world-abc123)";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://matters.town/@alice/hello-world-abc123");
  });

  it("handles multiple links on same line", () => {
    const content = "[link1](https://a.com) and [link2](https://b.com)";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe("https://a.com");
    expect(result[1].url).toBe("https://b.com");
  });

  it("handles links with empty text", () => {
    const content = "[](https://example.com)";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com");
  });

  it("handles relative links", () => {
    const content = "[local](./path/to/file.md)";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("./path/to/file.md");
  });

  it("handles empty content", () => {
    const result = extractMarkdownLinks("");
    expect(result).toHaveLength(0);
  });

  it("handles content with no links", () => {
    const content = "Just plain text without any links";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(0);
  });

  it("trims whitespace from URLs", () => {
    const content = "[link](  https://example.com  )";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com");
  });
});
