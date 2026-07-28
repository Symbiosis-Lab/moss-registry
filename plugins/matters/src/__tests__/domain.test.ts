import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";
import { apiConfig } from "../api";

// We'll import these after creating domain.ts
import {
  initializeDomain,
  getDomain,
  accessTokenCookieName,
  loginUrl,
  draftUrl,
  articleUrl,
  isMattersUrl,
  isInternalMattersLink,
  extractShortHash,
  collectionUrl,
  extractCollectionId,
  resetDomain,
} from "../domain";

const PLUGIN_NAME = "matters-syndicator";

describe("Domain Module", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ pluginName: PLUGIN_NAME });
    resetDomain(); // Reset to default before each test
  });

  afterEach(() => {
    ctx.cleanup();
    resetDomain();
  });

  describe("initializeDomain", () => {
    it("defaults to matters.town when no config", async () => {
      // No config file → defaults
      await initializeDomain();

      expect(getDomain()).toBe("matters.town");
      expect(apiConfig.endpoint).toBe("https://server.matters.town/graphql");
    });

    it("uses configured domain from config.json", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );

      await initializeDomain();

      expect(getDomain()).toBe("matters.icu");
      expect(apiConfig.endpoint).toBe("https://server.matters.icu/graphql");
    });

    it("updates manifest.json domain when different from config", async () => {
      // Set up existing manifest with matters.town
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/manifest.json`,
        JSON.stringify({
          name: "matters",
          version: "1.0.0",
          domain: "matters.town",
          entry: "main.bundle.js",
          capabilities: ["process", "syndicate"],
        })
      );

      // Set config to matters.icu
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );

      await initializeDomain();

      // Manifest should be updated
      const manifestContent = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/manifest.json`
      );
      expect(manifestContent).toBeDefined();
      const manifest = JSON.parse(manifestContent!.content);
      expect(manifest.domain).toBe("matters.icu");
    });

    it("does not update manifest when domain already matches", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/manifest.json`,
        JSON.stringify({
          name: "matters",
          version: "1.0.0",
          domain: "matters.icu",
          entry: "main.bundle.js",
          capabilities: ["process", "syndicate"],
        })
      );

      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );

      await initializeDomain();

      // Domain should be set correctly
      expect(getDomain()).toBe("matters.icu");
    });

    it("preserves other manifest fields when updating domain", async () => {
      const originalManifest = {
        name: "matters",
        version: "1.0.0",
        description: "Syndicate to Matters.town",
        domain: "matters.town",
        entry: "main.bundle.js",
        capabilities: ["process", "syndicate"],
        config: { auto_publish: false },
      };

      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/manifest.json`,
        JSON.stringify(originalManifest)
      );

      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );

      await initializeDomain();

      const manifestContent = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/manifest.json`
      );
      const manifest = JSON.parse(manifestContent!.content);

      expect(manifest.name).toBe("matters");
      expect(manifest.version).toBe("1.0.0");
      expect(manifest.description).toBe("Syndicate to Matters.town");
      expect(manifest.domain).toBe("matters.icu");
      expect(manifest.entry).toBe("main.bundle.js");
      expect(manifest.capabilities).toEqual(["process", "syndicate"]);
      expect(manifest.config).toEqual({ auto_publish: false });
    });
  });

  describe("URL builders", () => {
    it("loginUrl uses current domain", async () => {
      await initializeDomain(); // defaults to matters.town
      expect(loginUrl()).toBe("https://matters.town/login");
    });

    it("loginUrl uses configured domain", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();
      expect(loginUrl()).toBe("https://matters.icu/login");
    });

    it("draftUrl constructs correct URL", async () => {
      await initializeDomain();
      expect(draftUrl("draft-123")).toBe(
        "https://matters.town/me/drafts/draft-123"
      );
    });

    it("draftUrl uses configured domain", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();
      expect(draftUrl("draft-456")).toBe(
        "https://matters.icu/me/drafts/draft-456"
      );
    });

    it("articleUrl constructs correct URL", async () => {
      await initializeDomain();
      expect(articleUrl("alice", "my-article", "abc123")).toBe(
        "https://matters.town/@alice/my-article-abc123"
      );
    });

    it("articleUrl uses configured domain", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();
      expect(articleUrl("bob", "test-post", "xyz789")).toBe(
        "https://matters.icu/@bob/test-post-xyz789"
      );
    });
  });

  describe("isMattersUrl", () => {
    it("matches default domain", async () => {
      await initializeDomain();
      expect(isMattersUrl("https://matters.town/@alice/post-abc123")).toBe(true);
      expect(isMattersUrl("https://example.com/article")).toBe(false);
    });

    it("matches configured domain", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();

      expect(isMattersUrl("https://matters.icu/@alice/post-abc123")).toBe(true);
      // Should NOT match matters.town when configured to matters.icu
      expect(isMattersUrl("https://matters.town/@alice/post-abc123")).toBe(
        false
      );
    });

    it("handles edge cases", async () => {
      await initializeDomain();
      expect(isMattersUrl("")).toBe(false);
      expect(isMattersUrl("matters.town")).toBe(true); // contains domain
    });
  });

  describe("isInternalMattersLink", () => {
    it("matches user's own content on default domain", async () => {
      await initializeDomain();
      expect(
        isInternalMattersLink(
          "https://matters.town/@alice/my-post-abc",
          "alice"
        )
      ).toBe(true);
      expect(
        isInternalMattersLink(
          "https://matters.town/@bob/other-post-abc",
          "alice"
        )
      ).toBe(false);
    });

    it("matches user's own content on configured domain", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();

      expect(
        isInternalMattersLink(
          "https://matters.icu/@alice/my-post-abc",
          "alice"
        )
      ).toBe(true);
      // Should NOT match matters.town when configured to matters.icu
      expect(
        isInternalMattersLink(
          "https://matters.town/@alice/my-post-abc",
          "alice"
        )
      ).toBe(false);
    });
  });

  describe("getDomain", () => {
    it("returns default before initialization", () => {
      expect(getDomain()).toBe("matters.town");
    });

    it("returns configured domain after initialization", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();
      expect(getDomain()).toBe("matters.icu");
    });
  });

  describe("resetDomain", () => {
    it("resets to default", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();
      expect(getDomain()).toBe("matters.icu");

      resetDomain();
      expect(getDomain()).toBe("matters.town");
    });
  });

  // ==========================================================================
  // accessTokenCookieName — env-specific auth-token cookie name (guards A2/BUG#4)
  //
  // Regression guard: initializeDomain() derives the auth-token cookie name from
  // the finalized domain. Production (matters.town) names the cookie
  // `__access_token`; the staging web app (matters.icu) names it
  // `__dev__access_token`. Before this fix, the login poll watched the wrong
  // cookie on staging and never detected login. The cookie name is derived
  // purely from the resolved domain, whatever its source (config.json here, or
  // the MOSS_MATTERS_DOMAIN env override in the harness) — the same code path.
  // ==========================================================================
  describe("accessTokenCookieName", () => {
    it("resolves __access_token on production (default matters.town)", async () => {
      // No config file → defaults to matters.town.
      await initializeDomain();

      expect(getDomain()).toBe("matters.town");
      expect(accessTokenCookieName()).toBe("__access_token");
    });

    it("resolves __dev__access_token on staging (matters.icu)", async () => {
      // Staging domain, switched exactly like the existing domain tests do.
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();

      expect(getDomain()).toBe("matters.icu");
      expect(accessTokenCookieName()).toBe("__dev__access_token");
    });

    it("resetDomain restores the production cookie name", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();
      expect(accessTokenCookieName()).toBe("__dev__access_token");

      resetDomain();
      expect(accessTokenCookieName()).toBe("__access_token");
    });
  });
});

// ============================================================================
// extractShortHash — pure URL parsing (no Tauri context needed)
// ============================================================================

describe("extractShortHash", () => {
  it("extracts shortHash from standard Matters URL", () => {
    const url = "https://matters.town/@testuser/test-article-abc123def";
    expect(extractShortHash(url)).toBe("abc123def");
  });

  it("extracts shortHash from URL with multiple hyphens in slug", () => {
    const url = "https://matters.town/@testuser/my-long-article-title-xyz789";
    expect(extractShortHash(url)).toBe("xyz789");
  });

  it("extracts shortHash from Chinese article URL", () => {
    const url = "https://matters.town/@testuser/测试文章-shortHash123";
    expect(extractShortHash(url)).toBe("shortHash123");
  });

  it("returns null for invalid URL", () => {
    expect(extractShortHash("not a url")).toBe(null);
  });

  it("returns null for URL without path segments", () => {
    expect(extractShortHash("https://matters.town/")).toBe(null);
  });

  it("returns null for URL with only slug (no hyphen)", () => {
    expect(extractShortHash("https://matters.town/@testuser/article")).toBe(null);
  });

  it("extracts shortHash from /a/ short-link URL", () => {
    expect(extractShortHash("https://matters.town/a/aj5szksg7ppa")).toBe("aj5szksg7ppa");
  });

  it("extracts shortHash from /a/ short-link with query and fragment", () => {
    expect(extractShortHash("https://matters.town/a/aj5szksg7ppa?utm=x#comment")).toBe(
      "aj5szksg7ppa"
    );
  });

  it("returns null for bare /a path with no shortHash", () => {
    expect(extractShortHash("https://matters.town/a")).toBe(null);
    expect(extractShortHash("https://matters.town/a/")).toBe(null);
  });

  it("returns null for collection URLs (never mistakes a collection for an article)", () => {
    // No hyphen in the id — falls through hyphen parsing anyway
    expect(
      extractShortHash("https://matters.town/@guo/collections/Q29sbGVjdGlvbjo0ODQx")
    ).toBe(null);
    // Hyphen INSIDE the id (URL-safe base64) — must not yield a bogus shortHash
    expect(
      extractShortHash("https://matters.town/@guo/collections/abc-def")
    ).toBe(null);
  });
});

// ============================================================================
// Collection URLs — pure URL construction/parsing (no Tauri context needed)
// ============================================================================

describe("collectionUrl / extractCollectionId", () => {
  it("builds the canonical Matters collection URL", () => {
    expect(collectionUrl("guo", "Q29sbGVjdGlvbjo0ODQx")).toBe(
      "https://matters.town/@guo/collections/Q29sbGVjdGlvbjo0ODQx"
    );
  });

  it("round-trips: extractCollectionId(collectionUrl(...)) returns the id", () => {
    const id = "Q29sbGVjdGlvbjo0ODQx";
    expect(extractCollectionId(collectionUrl("guo", id))).toBe(id);
  });

  it("extracts the id from a collection URL with query/fragment", () => {
    expect(
      extractCollectionId("https://matters.town/@guo/collections/Q29sbGVjdGlvbjoxMzI?utm=x#top")
    ).toBe("Q29sbGVjdGlvbjoxMzI");
  });

  it("returns null for article URLs", () => {
    expect(
      extractCollectionId("https://matters.town/@guo/下一代开放互联网-vt5utvta7h49")
    ).toBe(null);
  });

  it("returns null for short-link and invalid URLs", () => {
    expect(extractCollectionId("https://matters.town/a/aj5szksg7ppa")).toBe(null);
    expect(extractCollectionId("not a url")).toBe(null);
    expect(extractCollectionId("https://matters.town/@guo/collections/")).toBe(null);
  });
});
