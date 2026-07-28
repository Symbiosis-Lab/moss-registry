/**
 * Collection identity — rename-proof sync for collections.
 *
 * Articles are deduped by identity (`syndicated:` URL → shortHash, found
 * anywhere in the project), but collections used to be deduped only by their
 * COMPUTED path (slugify(remote title)). Renaming a collection folder locally
 * made every subsequent sync re-create the old folder.
 *
 * These tests lock in the three-layer fix:
 * 1. Known-ID gate: a collection whose id is in the caller-supplied
 *    knownCollectionIds (persisted to plugin config after every sync) was
 *    synced once already — never re-create it, wherever it went.
 * 2. Identity marker: newly created collection files carry their Matters
 *    collection URL in `syndicated:`, so future syncs can match them exactly
 *    (like articles) even after rename/move — and without any config state.
 *    Known-but-markerless collections (synced before the marker existed) get
 *    the marker backfilled into their resolved local home file.
 * 3. Placement resolution: new member articles land in the collection's ACTUAL
 *    local folder (marker dir, else the majority folder of the local member
 *    articles that BELONG to this collection first), never in a re-created
 *    folder named after the remote title.
 */
// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";
import {
  syncToLocalFiles,
  scanLocalArticles,
  detectArticleFolder,
  nextKnownCollectionIds,
} from "../sync";
import { resetDomain } from "../domain";
import type {
  MattersArticle,
  MattersCollection,
  MattersUserProfile,
} from "../types";

const PROJECT = "/test/project";
const PLUGIN = "matters";
const COLLECTION_ID = "Q29sbGVjdGlvbjo0ODQx";
const COLLECTION_URL = `https://matters.town/@guo/collections/${COLLECTION_ID}`;

const profile: MattersUserProfile = {
  userName: "guo",
  displayName: "刘果",
  language: "zh_hans",
};

function makeArticle(overrides: Partial<MattersArticle>): MattersArticle {
  return {
    id: "a1",
    title: "下一代开放互联网",
    slug: "下一代开放互联网",
    shortHash: "vt5utvta7h49",
    content: "<p>body</p>",
    summary: "summary",
    createdAt: "2024-01-01T00:00:00Z",
    tags: [],
    ...overrides,
  };
}

function makeCollection(overrides: Partial<MattersCollection>): MattersCollection {
  return {
    id: COLLECTION_ID,
    title: "分布式信息网络",
    description: "去中心化网络中的博弈、设计和现实",
    articles: [
      {
        id: "a1",
        shortHash: "vt5utvta7h49",
        title: "下一代开放互联网",
        slug: "下一代开放互联网",
      },
    ],
    ...overrides,
  };
}

/** Seed an already-synced member article inside the RENAMED folder 文字/信息网络/. */
function seedRenamedCollectionState(ctx: MockTauriContext, homeWithMarker: boolean) {
  ctx.filesystem.setFile(
    `${PROJECT}/文字/信息网络/下一代开放互联网.md`,
    [
      "---",
      "title: 下一代开放互联网",
      "syndicated:",
      "- https://matters.town/@guo/下一代开放互联网-vt5utvta7h49",
      "---",
      "",
      "body",
    ].join("\n")
  );
  const markerLines = homeWithMarker
    ? ["syndicated:", `- ${COLLECTION_URL}`]
    : [];
  ctx.filesystem.setFile(
    `${PROJECT}/文字/信息网络/信息网络.md`,
    ["---", "is_collection: 'true'", ...markerLines, "---", "", "去中心化网络"].join("\n")
  );
}

function syncArgs(
  articles: MattersArticle[],
  collections: MattersCollection[],
  knownIds?: string[]
): Parameters<typeof syncToLocalFiles> {
  // homepageFile "刘果.md" → skip homepage generation (covered separately)
  return [
    articles,
    [],
    collections,
    "guo",
    {},
    profile,
    "刘果.md",
    "刘果",
    undefined,
    knownIds ? new Set(knownIds) : undefined,
  ];
}

describe("collection identity", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: PROJECT, pluginName: PLUGIN });
    resetDomain();
  });

  afterEach(() => {
    ctx.cleanup();
    resetDomain();
  });

  describe("known-ID gate", () => {
    it("does not re-create a renamed collection whose id was synced before", async () => {
      seedRenamedCollectionState(ctx, false); // customized home, NO marker

      const { result } = await syncToLocalFiles(
        ...syncArgs([makeArticle({})], [makeCollection({})], [COLLECTION_ID])
      );

      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/分布式信息网络/分布式信息网络.md`)
      ).toBeUndefined();
      expect(result.errors).toEqual([]);
    });

    it("still creates collections with unknown ids", async () => {
      seedRenamedCollectionState(ctx, false);

      await syncToLocalFiles(
        ...syncArgs([makeArticle({})], [makeCollection({})], ["Q29sbGVjdGlvbjo5OTk5"])
      );

      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/分布式信息网络/分布式信息网络.md`)
      ).toBeDefined();
    });
  });

  describe("identity marker", () => {
    it("stamps new collection files with their Matters collection URL", async () => {
      seedRenamedCollectionState(ctx, false);
      // No known ids — collection is new from the plugin's point of view…
      // …but the folder was renamed, so it re-creates. The point here is the
      // created file must carry the identity marker for FUTURE syncs.
      await syncToLocalFiles(...syncArgs([makeArticle({})], [makeCollection({})]));

      const created = ctx.filesystem.getFile(
        `${PROJECT}/文字/分布式信息网络/分布式信息网络.md`
      );
      expect(created).toBeDefined();
      expect(created!.content).toContain(COLLECTION_URL);
    });

    it("does not re-create a collection whose marker exists under a renamed folder", async () => {
      seedRenamedCollectionState(ctx, true); // home carries the marker
      // NO knownCollectionIds at all — marker alone must gate

      const { result } = await syncToLocalFiles(
        ...syncArgs([makeArticle({})], [makeCollection({})])
      );

      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/分布式信息网络/分布式信息网络.md`)
      ).toBeUndefined();
      expect(result.errors).toEqual([]);
    });
  });

  describe("marker backfill", () => {
    it("backfills the marker into a known collection's resolved home file, preserving bytes", async () => {
      seedRenamedCollectionState(ctx, false); // customized home, NO marker
      const before = ctx.filesystem.getFile(
        `${PROJECT}/文字/信息网络/信息网络.md`
      )!.content;

      await syncToLocalFiles(
        ...syncArgs([makeArticle({})], [makeCollection({})], [COLLECTION_ID])
      );

      const after = ctx.filesystem.getFile(
        `${PROJECT}/文字/信息网络/信息网络.md`
      )!.content;
      expect(after).toContain(COLLECTION_URL);
      // Byte-preserving: removing exactly the inserted lines restores the original
      expect(after.replace(`syndicated:\n- ${COLLECTION_URL}\n`, "")).toBe(before);
    });

    it("does not backfill into the article folder's own home file", async () => {
      // All member articles at the article-folder ROOT (no sub-folder), and
      // the article folder has a self-named home. Resolution lands on 文字
      // itself, where the home belongs to the SECTION, not the collection.
      ctx.filesystem.setFile(
        `${PROJECT}/文字/下一代开放互联网.md`,
        [
          "---",
          "title: 下一代开放互联网",
          "syndicated:",
          "- https://matters.town/@guo/下一代开放互联网-vt5utvta7h49",
          "---",
          "",
          "body",
        ].join("\n")
      );
      const sectionHome = ["---", "title: 文字", "---", "", "section"].join("\n");
      ctx.filesystem.setFile(`${PROJECT}/文字/文字.md`, sectionHome);

      await syncToLocalFiles(
        ...syncArgs([makeArticle({})], [makeCollection({})], [COLLECTION_ID])
      );

      expect(ctx.filesystem.getFile(`${PROJECT}/文字/文字.md`)!.content).toBe(
        sectionHome
      );
    });

    it("does not backfill for unknown collections", async () => {
      seedRenamedCollectionState(ctx, false);
      const before = ctx.filesystem.getFile(
        `${PROJECT}/文字/信息网络/信息网络.md`
      )!.content;

      await syncToLocalFiles(...syncArgs([makeArticle({})], [makeCollection({})]));

      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/信息网络/信息网络.md`)!.content
      ).toBe(before);
    });
  });

  describe("placement of new member articles", () => {
    const newArticle = () =>
      makeArticle({
        id: "a2",
        title: "新文章",
        slug: "新文章",
        shortHash: "newhash12345",
      });
    const collectionWithNewMember = () =>
      makeCollection({
        articles: [
          { id: "a1", shortHash: "vt5utvta7h49", title: "下一代开放互联网", slug: "下一代开放互联网" },
          { id: "a2", shortHash: "newhash12345", title: "新文章", slug: "新文章" },
        ],
      });

    it("places a new member article into the marker-resolved folder", async () => {
      seedRenamedCollectionState(ctx, true);

      const { articlePathMap } = await syncToLocalFiles(
        ...syncArgs([makeArticle({}), newArticle()], [collectionWithNewMember()])
      );

      expect(ctx.filesystem.getFile(`${PROJECT}/文字/信息网络/新文章.md`)).toBeDefined();
      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/分布式信息网络/新文章.md`)
      ).toBeUndefined();
      expect(articlePathMap.get("newhash12345")).toBe("文字/信息网络/新文章.md");
    });

    it("places a new member article by majority folder of local members when no marker exists", async () => {
      seedRenamedCollectionState(ctx, false); // no marker

      await syncToLocalFiles(
        ...syncArgs(
          [makeArticle({}), newArticle()],
          [collectionWithNewMember()],
          [COLLECTION_ID]
        )
      );

      expect(ctx.filesystem.getFile(`${PROJECT}/文字/信息网络/新文章.md`)).toBeDefined();
      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/分布式信息网络/新文章.md`)
      ).toBeUndefined();
    });

    const seedArticleFile = (path: string, title: string, hash: string) => {
      ctx.filesystem.setFile(
        `${PROJECT}/${path}`,
        [
          "---",
          `title: ${title}`,
          "syndicated:",
          `- https://matters.town/@guo/${title}-${hash}`,
          "---",
          "",
          "body",
        ].join("\n")
      );
    };

    it("outvotes a stray member living in another collection's folder", async () => {
      // 文章一 was moved to collection B remotely but the user never moved its
      // file out of A's folder. B's real (renamed) folder is 乙集, holding two
      // of its members — the plurality must follow 乙集, not A's folder.
      seedArticleFile("文字/合集A/文章零.md", "文章零", "aaaa0000");
      seedArticleFile("文字/合集A/文章一.md", "文章一", "aaaa1111");
      seedArticleFile("文字/乙集/文章二.md", "文章二", "bbbb2222");
      seedArticleFile("文字/乙集/文章四.md", "文章四", "dddd4444");

      const collA = makeCollection({
        id: "Q29sbGVjdGlvbjpB",
        title: "合集A",
        articles: [{ id: "x0", shortHash: "aaaa0000", title: "文章零", slug: "文章零" }],
      });
      const collB = makeCollection({
        id: "Q29sbGVjdGlvbjpC",
        title: "合集B",
        articles: [
          { id: "x1", shortHash: "aaaa1111", title: "文章一", slug: "文章一" },
          { id: "x2", shortHash: "bbbb2222", title: "文章二", slug: "文章二" },
          { id: "x4", shortHash: "dddd4444", title: "文章四", slug: "文章四" },
          { id: "x3", shortHash: "cccc3333", title: "文章三", slug: "文章三" },
        ],
      });

      await syncToLocalFiles(
        ...syncArgs(
          [makeArticle({ id: "x3", title: "文章三", slug: "文章三", shortHash: "cccc3333" })],
          [collA, collB],
          ["Q29sbGVjdGlvbjpB", "Q29sbGVjdGlvbjpC"]
        )
      );

      // 文章三 is B-first → must land in B's renamed folder 文字/乙集/
      expect(ctx.filesystem.getFile(`${PROJECT}/文字/乙集/文章三.md`)).toBeDefined();
      expect(ctx.filesystem.getFile(`${PROJECT}/文字/合集A/文章三.md`)).toBeUndefined();
      expect(ctx.filesystem.getFile(`${PROJECT}/文字/合集b/文章三.md`)).toBeUndefined();
    });

    it("never lets one collection claim another collection's resolved folder", async () => {
      // B's ONLY locally-present member is the stray 文章一 sitting in A's
      // folder, so B's plurality points at A's folder — a collision with A
      // itself. A must keep its folder (more own members), B goes unresolved:
      // B's new article lands at the article root and A's home file must NOT
      // be stamped with B's identity.
      seedArticleFile("文字/合集A/文章零.md", "文章零", "aaaa0000");
      seedArticleFile("文字/合集A/文章五.md", "文章五", "eeee5555");
      seedArticleFile("文字/合集A/文章一.md", "文章一", "aaaa1111");
      const homeA = ["---", "title: 合集A", "---", "", "A home"].join("\n");
      ctx.filesystem.setFile(`${PROJECT}/文字/合集A/合集A.md`, homeA);

      const collA = makeCollection({
        id: "Q29sbGVjdGlvbjpB",
        title: "合集A",
        articles: [
          { id: "x0", shortHash: "aaaa0000", title: "文章零", slug: "文章零" },
          { id: "x5", shortHash: "eeee5555", title: "文章五", slug: "文章五" },
        ],
      });
      const collB = makeCollection({
        id: "Q29sbGVjdGlvbjpC",
        title: "合集B",
        articles: [
          { id: "x1", shortHash: "aaaa1111", title: "文章一", slug: "文章一" },
          { id: "x3", shortHash: "cccc3333", title: "文章三", slug: "文章三" },
        ],
      });

      await syncToLocalFiles(
        ...syncArgs(
          [makeArticle({ id: "x3", title: "文章三", slug: "文章三", shortHash: "cccc3333" })],
          [collA, collB],
          ["Q29sbGVjdGlvbjpB", "Q29sbGVjdGlvbjpC"]
        )
      );

      // B unresolved → its new article at the article root, no folder revival
      expect(ctx.filesystem.getFile(`${PROJECT}/文字/文章三.md`)).toBeDefined();
      expect(ctx.filesystem.getFile(`${PROJECT}/文字/合集A/文章三.md`)).toBeUndefined();
      // A's home keeps A's identity: backfilled with A's marker, never B's
      const homeAfter = ctx.filesystem.getFile(`${PROJECT}/文字/合集A/合集A.md`)!.content;
      expect(homeAfter).toContain("collections/Q29sbGVjdGlvbjpB");
      expect(homeAfter).not.toContain("collections/Q29sbGVjdGlvbjpC");
    });

    it("places new members of a fully-deleted known collection at the article-folder root", async () => {
      // The user deleted the whole collection folder. Respect that: no
      // remote-title folder comes back; the new article lands at the root.
      ctx.filesystem.setFile(
        `${PROJECT}/文字/等等.md`,
        [
          "---",
          "title: 等等",
          "syndicated:",
          "- https://matters.town/@guo/等等-standalone99",
          "---",
          "",
          "body",
        ].join("\n")
      );

      await syncToLocalFiles(
        ...syncArgs(
          [newArticle()],
          [
            makeCollection({
              articles: [
                { id: "a2", shortHash: "newhash12345", title: "新文章", slug: "新文章" },
              ],
            }),
          ],
          [COLLECTION_ID]
        )
      );

      expect(ctx.filesystem.getFile(`${PROJECT}/文字/新文章.md`)).toBeDefined();
      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/分布式信息网络/新文章.md`)
      ).toBeUndefined();
      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/分布式信息网络/分布式信息网络.md`)
      ).toBeUndefined();
    });

    it("does NOT let member location hijack a genuinely new collection", async () => {
      // Existing standalone article at the article-folder root, remote adds a
      // NEW collection containing it. The collection must be created at its
      // computed path; the local standalone stays put.
      ctx.filesystem.setFile(
        `${PROJECT}/文字/等等.md`,
        [
          "---",
          "title: 等等",
          "syndicated:",
          "- https://matters.town/@guo/等等-standalone99",
          "---",
          "",
          "body",
        ].join("\n")
      );

      await syncToLocalFiles(
        ...syncArgs(
          [makeArticle({ id: "a3", title: "等等", slug: "等等", shortHash: "standalone99" })],
          [
            makeCollection({
              id: "Q29sbGVjdGlvbjoxMjM0",
              title: "新合集",
              articles: [{ id: "a3", shortHash: "standalone99", title: "等等", slug: "等等" }],
            }),
          ]
        )
      );

      expect(ctx.filesystem.getFile(`${PROJECT}/文字/新合集/新合集.md`)).toBeDefined();
    });
  });

  describe("synced collection ids (persist contract)", () => {
    it("reports created, marker-gated, and known-gated collections as synced", async () => {
      seedRenamedCollectionState(ctx, true); // marker gate for COLLECTION_ID
      const newColl = makeCollection({
        id: "Q29sbGVjdGlvbjpuZXc",
        title: "新合集",
        articles: [],
      });
      const knownColl = makeCollection({
        id: "Q29sbGVjdGlvbjprbm93bg",
        title: "旧合集",
        articles: [],
      });

      const { syncedCollectionIds } = await syncToLocalFiles(
        ...syncArgs(
          [makeArticle({})],
          [makeCollection({}), newColl, knownColl],
          ["Q29sbGVjdGlvbjprbm93bg"]
        )
      );

      expect(new Set(syncedCollectionIds)).toEqual(
        new Set([COLLECTION_ID, "Q29sbGVjdGlvbjpuZXc", "Q29sbGVjdGlvbjprbm93bg"])
      );
    });

    it("excludes a collection whose file creation failed", async () => {
      seedRenamedCollectionState(ctx, false);
      // Make the write of the new collection file fail
      const tauri = (window as unknown as {
        __TAURI__: { core: { invoke: (cmd: string, payload?: unknown) => Promise<unknown> } };
      }).__TAURI__;
      const origInvoke = tauri.core.invoke;
      tauri.core.invoke = async (cmd: string, payload?: unknown) => {
        const rel = (payload as { relativePath?: string } | undefined)?.relativePath;
        if (cmd === "write_project_file" && rel?.includes("分布式信息网络")) {
          throw new Error("disk full");
        }
        return origInvoke(cmd, payload);
      };

      const { result, syncedCollectionIds } = await syncToLocalFiles(
        ...syncArgs([makeArticle({})], [makeCollection({})])
      );

      expect(syncedCollectionIds).not.toContain(COLLECTION_ID);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("nextKnownCollectionIds unions stored and synced ids", () => {
      expect(nextKnownCollectionIds(["a", "b"], ["b", "c"]).sort()).toEqual([
        "a",
        "b",
        "c",
      ]);
      expect(nextKnownCollectionIds(undefined, ["x"])).toEqual(["x"]);
      // A collection missing from one remote fetch keeps its stored identity
      expect(nextKnownCollectionIds(["gone-remote"], [])).toEqual(["gone-remote"]);
    });
  });

  describe("scanLocalArticles", () => {
    it("does not report collection marker files as articles", async () => {
      seedRenamedCollectionState(ctx, true);

      const articles = await scanLocalArticles();

      expect(articles).toHaveLength(1);
      expect(articles[0].shortHash).toBe("vt5utvta7h49");
      expect(articles[0].path).toBe("文字/信息网络/下一代开放互联网.md");
    });
  });

  describe("article folder detection", () => {
    it("is not influenced by collection marker files", async () => {
      // Only a collection marker exists (moved OUTSIDE the article folder) —
      // it must not define the article folder.
      ctx.filesystem.setFile(
        `${PROJECT}/projects/合集.md`,
        ["---", "syndicated:", `- ${COLLECTION_URL}`, "---", "", "x"].join("\n")
      );
      expect(await detectArticleFolder()).toBeNull();

      // With a real article present, the article's folder wins.
      ctx.filesystem.setFile(
        `${PROJECT}/文字/文章.md`,
        [
          "---",
          "syndicated:",
          "- https://matters.town/@guo/文章-abcd1234",
          "---",
          "",
          "x",
        ].join("\n")
      );
      expect(await detectArticleFolder()).toBe("文字");
    });
  });

  describe("homepage pinned works", () => {
    const pinnedProfile = (): MattersUserProfile => ({
      ...profile,
      pinnedWorks: [{ id: COLLECTION_ID, type: "collection", title: "分布式信息网络" }],
    });

    it("links a pinned collection to its resolved local folder", async () => {
      seedRenamedCollectionState(ctx, true);

      await syncToLocalFiles(
        [makeArticle({})],
        [],
        [makeCollection({})],
        "guo",
        {},
        pinnedProfile(),
        null, // no homepage yet → generate one
        "刘果"
      );

      const home = ctx.filesystem.getFile(`${PROJECT}/刘果.md`);
      expect(home).toBeDefined();
      expect(home!.content).toContain("(/文字/信息网络/)");
      expect(home!.content).not.toContain("(/文字/分布式信息网络/)");
    });

    it("links a folder-home marker at the folder URL even in file mode", async () => {
      seedRenamedCollectionState(ctx, true);
      // Force file mode: one article in TWO collections
      const otherColl = makeCollection({
        id: "Q29sbGVjdGlvbjpvdGhlcg",
        title: "其他",
        articles: [
          { id: "a1", shortHash: "vt5utvta7h49", title: "下一代开放互联网", slug: "下一代开放互联网" },
        ],
      });

      await syncToLocalFiles(
        [makeArticle({})],
        [],
        [makeCollection({}), otherColl],
        "guo",
        {},
        pinnedProfile(),
        null,
        "刘果",
        undefined,
        new Set(["Q29sbGVjdGlvbjpvdGhlcg"])
      );

      const home = ctx.filesystem.getFile(`${PROJECT}/刘果.md`);
      expect(home).toBeDefined();
      // Folder-home marker renders at the folder URL, not /…/信息网络/信息网络
      expect(home!.content).toContain("(/文字/信息网络/)");
      expect(home!.content).not.toContain("信息网络/信息网络");
    });

    it("never renders a protocol-relative (//) link for a root-level marker", async () => {
      // Marker file moved to the project ROOT
      ctx.filesystem.setFile(
        `${PROJECT}/信息网络.md`,
        ["---", "syndicated:", `- ${COLLECTION_URL}`, "---", "", "x"].join("\n")
      );
      // An article so the folder detects as 文字
      ctx.filesystem.setFile(
        `${PROJECT}/文字/文章.md`,
        [
          "---",
          "syndicated:",
          "- https://matters.town/@guo/文章-abcd1234",
          "---",
          "",
          "x",
        ].join("\n")
      );

      await syncToLocalFiles(
        [],
        [],
        [makeCollection({ articles: [] })],
        "guo",
        {},
        pinnedProfile(),
        null,
        "刘果"
      );

      const home = ctx.filesystem.getFile(`${PROJECT}/刘果.md`);
      expect(home).toBeDefined();
      expect(home!.content).not.toContain("(//)");
      expect(home!.content).toContain("(/信息网络)");
    });
  });
});
