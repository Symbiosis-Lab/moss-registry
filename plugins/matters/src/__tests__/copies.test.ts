import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CopyJob } from "@symbiosis-lab/moss-api";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@symbiosis-lab/moss-api", () => ({
  pluginFileExists: vi.fn(async (file: string) => storage.has(file)),
  readPluginFile: vi.fn(async (file: string) => storage.get(file)),
  writePluginFile: vi.fn(async (file: string, text: string) => { storage.set(file, text); }),
  readSiteFile: vi.fn(async () => "aW1hZ2U="),
}));
vi.mock("../credential", () => ({ clearTokenCache: vi.fn(), getSessionState: vi.fn(async () => "valid") }));
vi.mock("../domain", () => ({
  initializeDomain: vi.fn(), getDomain: () => "matters.town",
  articleUrl: (_u: string, _s: string, hash: string) => `https://matters.town/a/${hash}`,
  momentUrl: (hash: string) => `https://matters.town/m/${hash}`,
}));
vi.mock("../config", () => ({ getConfig: vi.fn(async () => ({ userName: "alice" })) }));
vi.mock("../utils", () => ({ sleep: vi.fn(), setCurrentHookName: vi.fn() }));
vi.mock("../api", async (original) => ({
  ...await original<typeof import("../api")>(),
  createDraft: vi.fn(), fetchDraft: vi.fn(), fetchAllArticles: vi.fn(), fetchRemoteCopy: vi.fn(),
  publishArticle: vi.fn(), editArticle: vi.fn(), deleteMoment: vi.fn(), putMoment: vi.fn(), fetchUserProfile: vi.fn(),
  uploadAssetMultipart: vi.fn(), uploadAssetByUrl: vi.fn(),
}));
import * as api from "../api";
import { getSessionState } from "../credential";
import { initializeDomain } from "../domain";
import { readSiteFile, writePluginFile, readPluginFile } from "@symbiosis-lab/moss-api";
import { publish_copy, find_copy, update_copy, delete_copy, momentHtml } from "../copies";
import { normalizeHtmlForMatters, uploadAndReplaceLocalImages } from "../content";

const article = { __typename: "Article" as const, id: "QXJ0aWNsZTox", shortHash: "hash", slug: "title", state: "active" };
const draft = { id: "RHJhZnQ6MQ==", title: "Title", content: "", createdAt: "", publishState: "unpublished" as const };
const live = { ...draft, publishState: "published" as const, article };
const job = (html = "<p>Body</p>"): CopyJob => ({
  op: "publish", channel: "matters", idempotency_key: "stable-key", form: "long",
  post: { url: "https://site.test/post/", source_path: "post.md", title: "Title", tags: ["tag"] },
  article: { title: "Title", html, description: "Summary" }, config: { link_back: false },
});
const previous = { id: article.id, url: "https://matters.town/a/hash" };
const existing = (): CopyJob => ({ ...job(), previous });
const record = () => JSON.parse([...storage.values()][0]);
function seed(value: unknown) {
  // Capture the same storage filename a real send uses, without duplicating hashing logic.
  for (const key of storage.keys()) storage.set(key, JSON.stringify(value));
}

beforeEach(() => {
  vi.clearAllMocks(); storage.clear();
  vi.mocked(getSessionState).mockResolvedValue("valid");
  vi.mocked(initializeDomain).mockResolvedValue(undefined);
  vi.mocked(writePluginFile).mockImplementation(async (file, text) => { storage.set(file, text); });
  vi.mocked(readPluginFile).mockImplementation(async (file) => storage.get(file)!);
  vi.mocked(readSiteFile).mockResolvedValue("aW1hZ2U=");
  vi.mocked(api.createDraft).mockReset().mockResolvedValue(draft);
  vi.mocked(api.publishArticle).mockReset().mockResolvedValue(live);
  vi.mocked(api.fetchDraft).mockReset().mockResolvedValue(draft);
  vi.mocked(api.fetchRemoteCopy).mockReset().mockResolvedValue(article);
  vi.mocked(api.fetchAllArticles).mockReset().mockResolvedValue({ userName: "alice", articles: [] });
  vi.mocked(api.editArticle).mockReset().mockResolvedValue(article);
  vi.mocked(api.deleteMoment).mockReset().mockResolvedValue({ id: "moment-id", state: "archived" });
  vi.mocked(api.putMoment).mockReset().mockResolvedValue({ id: "moment-id", shortHash: "mhash" });
  vi.mocked(api.uploadAssetMultipart).mockReset().mockResolvedValue({ id: "asset", path: "https://assets.matters.news/image.png" });
  vi.mocked(api.uploadAssetByUrl).mockReset().mockResolvedValue({ id: "external", path: "https://assets.matters.news/external.png" });
});

describe("direct article lifecycle", () => {
  it("publishes directly with Article ID and URL after preparing the draft", async () => {
    expect(await publish_copy(job())).toMatchObject({ success: true, copy: previous });
    expect(api.createDraft).toHaveBeenCalledTimes(2);
    expect(api.publishArticle).toHaveBeenCalledExactlyOnceWith(draft.id);
    expect(record()).toMatchObject({ phase: "published", articleId: article.id, draftId: draft.id });
    expect(api.createDraft).toHaveBeenLastCalledWith({ id: draft.id, title: "Title", content: "<p>Body</p>", summary: "Summary", tags: ["tag"], cover: null });
  });
  it("waits for pending publication to become active", async () => {
    vi.mocked(api.publishArticle).mockResolvedValue({ ...draft, publishState: "pending" });
    vi.mocked(api.fetchDraft).mockResolvedValueOnce(draft).mockResolvedValue(live);
    expect(await publish_copy(job())).toMatchObject({ success: true, copy: previous });
    expect(api.fetchDraft).toHaveBeenCalledTimes(2);
  });
  it("bounded unconfirmed publication throws and recovery never reports absence", async () => {
    vi.mocked(api.publishArticle).mockResolvedValue({ ...draft, publishState: "pending" });
    await expect(publish_copy(job())).rejects.toThrow("unconfirmed");
    expect(api.fetchDraft).toHaveBeenCalledTimes(6);
    expect(record().phase).toBe("publishing");
    expect(await find_copy(job())).toMatchObject({ success: false });
    await expect(publish_copy(job())).rejects.toThrow("unconfirmed");
    expect(api.publishArticle).toHaveBeenCalledTimes(1);
    expect(api.createDraft).toHaveBeenCalledTimes(2);
  });
  it("stops polling before a seventh fetch even if publication stays pending", async () => {
    const pending = { ...draft, publishState: "pending" as const };
    vi.mocked(api.publishArticle).mockResolvedValue(pending);
    let polls = 0;
    vi.mocked(api.fetchDraft).mockImplementation(async () => {
      if (++polls > 6) throw new Error("POLL_BOUND_REMOVED_SENTINEL");
      return pending;
    });
    await expect(publish_copy(job())).rejects.toThrow("unconfirmed");
    expect(polls).toBe(6);
    expect(record().phase).toBe("publishing");
    expect(api.publishArticle).toHaveBeenCalledTimes(1);
  });
  it("rejects a published response without an active Article", async () => {
    vi.mocked(api.publishArticle).mockResolvedValue({ ...live, article: { ...article, state: "pending" } });
    await expect(publish_copy(job())).rejects.toThrow("unconfirmed");
  });
  it.each(["id", "shortHash", "slug"] as const)("requires published identity field %s", async (field) => {
    vi.mocked(api.publishArticle).mockResolvedValue({ ...live, article: { ...article, [field]: "" } });
    await expect(publish_copy(job())).rejects.toThrow("ID and address");
  });
  it("recovers a lost publish response without backlinks or a second article", async () => {
    vi.mocked(api.publishArticle).mockRejectedValueOnce(new Error("connection lost"));
    await expect(publish_copy(job())).rejects.toThrow("connection lost");
    vi.mocked(api.fetchDraft).mockResolvedValue(live);
    expect(await find_copy({ ...job(), article: { title: "Changed", html: "<p>Changed too</p>" } })).toMatchObject({ success: true, copy: previous });
    expect(await publish_copy(job())).toMatchObject({ success: true, copy: previous });
    expect(api.publishArticle).toHaveBeenCalledTimes(1);
    expect(api.createDraft).toHaveBeenCalledTimes(2);
  });
  it("explicit refusal remains retryable on the same draft", async () => {
    vi.mocked(api.publishArticle).mockRejectedValueOnce(new api.MattersRefusal("too long", 200, "BAD_USER_INPUT"));
    expect(await publish_copy(job())).toMatchObject({ success: false, copy: { refused: { cause: "content", message: "too long" } } });
    expect(record().phase).toBe("prepared");
    expect(await find_copy(job())).toMatchObject({ success: true, copy: null });
    expect(await publish_copy(job())).toMatchObject({ success: true, copy: previous });
    expect(api.createDraft.mock.calls.filter(([input]) => !input.id)).toHaveLength(1);
  });
  it("clears a removed cover when retrying a refused publish on the same draft", async () => {
    const input = job();
    input.article!.cover = "/cover.png";
    vi.mocked(api.publishArticle).mockRejectedValueOnce(new api.MattersRefusal("too long", 200, "BAD_USER_INPUT"));
    expect(await publish_copy(input)).toMatchObject({ success: false, copy: { refused: { cause: "content" } } });
    expect(api.createDraft).toHaveBeenLastCalledWith(expect.objectContaining({ id: draft.id, cover: "asset" }));
    expect(record()).toMatchObject({ phase: "prepared", draftId: draft.id });

    input.article!.cover = null;
    expect(await publish_copy(input)).toMatchObject({ success: true, copy: previous });
    expect(api.createDraft).toHaveBeenLastCalledWith({
      id: draft.id, title: "Title", content: "<p>Body</p>", summary: "Summary", tags: ["tag"], cover: null,
    });
    expect(api.createDraft.mock.calls.filter(([value]) => !value.id)).toHaveLength(1);
    expect(api.publishArticle.mock.calls).toEqual([[draft.id], [draft.id]]);
    expect(api.uploadAssetMultipart).toHaveBeenCalledTimes(1);
  });
  it("lost draft response blocks duplicate draft creation", async () => {
    vi.mocked(api.createDraft).mockRejectedValue(new Error("connection lost"));
    await expect(publish_copy(job())).rejects.toThrow("connection lost");
    await expect(publish_copy(job())).rejects.toThrow("draft creation is unconfirmed");
    expect(await find_copy(job())).toMatchObject({ success: false });
    expect(api.createDraft).toHaveBeenCalledTimes(1);
  });
  it("requires a draft ID before publication", async () => {
    vi.mocked(api.createDraft).mockResolvedValue({ ...draft, id: "" });
    await expect(publish_copy(job())).rejects.toThrow("draft ID");
    expect(api.publishArticle).not.toHaveBeenCalled();
  });
  it("storage failure before sending prevents publication", async () => {
    vi.mocked(writePluginFile).mockRejectedValueOnce(new Error("disk full"));
    await expect(publish_copy(job())).rejects.toThrow("disk full");
    expect(api.createDraft).not.toHaveBeenCalled();
  });
  it("storage failure after draft creation never retries creation", async () => {
    vi.mocked(writePluginFile).mockImplementationOnce(async (f,t) => { storage.set(f,t); }).mockRejectedValueOnce(new Error("disk full"));
    await expect(publish_copy(job())).rejects.toThrow("disk full");
    await expect(publish_copy(job())).rejects.toThrow("draft creation is unconfirmed");
    expect(api.createDraft).toHaveBeenCalledTimes(1);
  });
  it("malformed recovery records never create another draft", async () => {
    await publish_copy(job()); seed({ phase: "nonsense" });
    await expect(publish_copy(job())).rejects.toThrow("record is invalid");
    seed({ phase: "prepared" });
    await expect(publish_copy(job())).rejects.toThrow("record is invalid");
    expect(api.createDraft).toHaveBeenCalledTimes(2);
  });
  it.each([
    null, [], "published", { phase: "prepared", draftId: 3 },
    { phase: "publishing", draftId: {} }, { phase: "publishing", draftId: " " },
    { phase: "published", draftId: draft.id, articleId: [] },
    { phase: "published", draftId: draft.id, articleId: " " },
    { phase: "published", articleId: article.id },
    { phase: "absent", draftId: draft.id },
    { phase: "creating", articleId: article.id },
    { phase: "prepared", draftId: draft.id, articleId: article.id },
  ])("rejects invalid persisted state %j without sending", async (value) => {
    await publish_copy(job()); seed(value);
    vi.mocked(api.createDraft).mockClear(); vi.mocked(api.publishArticle).mockClear();
    await expect(publish_copy(job())).rejects.toThrow("record is invalid");
    expect(await find_copy(job())).toMatchObject({ success: false });
    expect(api.createDraft).not.toHaveBeenCalled(); expect(api.publishArticle).not.toHaveBeenCalled();
  });
  it("missing or pending recorded drafts cannot be replaced", async () => {
    await publish_copy(job()); seed({ phase: "prepared", draftId: draft.id });
    vi.mocked(api.fetchDraft).mockResolvedValueOnce(null);
    await expect(publish_copy(job())).rejects.toThrow("recorded Matters draft is missing");
    vi.mocked(api.fetchDraft).mockResolvedValue({ ...draft, publishState: "pending" });
    await expect(publish_copy(job())).rejects.toThrow("not ready");
    expect(api.createDraft).toHaveBeenCalledTimes(2);
  });
  it("prepared recovery adopts a draft already published", async () => {
    await publish_copy(job()); seed({ phase: "prepared", draftId: draft.id });
    vi.mocked(api.fetchDraft).mockResolvedValue(live);
    expect(await publish_copy(job())).toMatchObject({ success: true, copy: previous });
    expect(api.publishArticle).toHaveBeenCalledTimes(1);
  });
  it("a missing previously published copy is not a successful publish", async () => {
    vi.mocked(api.fetchRemoteCopy).mockResolvedValue(null);
    await expect(publish_copy(existing())).rejects.toThrow("unconfirmed");
    expect(api.createDraft).not.toHaveBeenCalled();
  });
  it("authentication and domain failures refuse before creating anything", async () => {
    vi.mocked(getSessionState).mockResolvedValue("expired");
    expect(await publish_copy(job())).toMatchObject({ copy: { refused: { cause: "auth" } } });
    vi.mocked(initializeDomain).mockRejectedValue(new Error("offline"));
    expect(await publish_copy(job())).toMatchObject({ copy: { refused: { cause: "network" } } });
    expect(api.createDraft).not.toHaveBeenCalled();
  });
  it("empty long articles refuse before creating a draft", async () => {
    expect(await publish_copy(job("  "))).toMatchObject({ copy: { refused: { cause: "content" } } });
    expect(api.createDraft).not.toHaveBeenCalled();
  });
});

describe("pictures and core-owned content", () => {
  it("uploads local, external, data and formula pictures and cover before publication", async () => {
    const input = job(`<p><code>const x = 1</code></p><img src="../图.png"><img src='https://cdn.test/photo.png'><img alt="x > y" src="data:image/png;base64,aW1hZ2U="><picture><source srcset="https://site.test/large.png"><img src=/small.png srcset="https://site.test/large.png 2x"></picture>`);
    input.article!.cover = "https://cdn.test/cover.jpg";
    await publish_copy(input);
    expect(api.uploadAssetMultipart).toHaveBeenCalledTimes(3);
    expect(api.uploadAssetByUrl).toHaveBeenCalledTimes(2);
    const content = api.createDraft.mock.calls.at(-1)![0].content!;
    expect(content).toContain('alt="x > y"');
    expect(content).toContain("<code>const x = 1</code>");
    expect(content).not.toMatch(/cdn.test|srcset|data:image|src=\/|src="\.\./);
    expect(api.createDraft).toHaveBeenLastCalledWith(expect.objectContaining({ cover: "external" }));
    expect(api.publishArticle.mock.invocationCallOrder[0]).toBeGreaterThan(api.uploadAssetByUrl.mock.invocationCallOrder.at(-1)!);
    expect(readSiteFile).toHaveBeenCalledWith("图.png");
  });
  it.each(["local", "external", "data", "cover"])("any %s image failure refuses the whole copy", async (kind) => {
    const input = job(kind === "external" ? '<img src="https://cdn.test/broken.png">' : kind === "data" ? '<img src="data:image/png;base64,aW1hZ2U=">' : '<img src="/broken.png">');
    if (kind === "cover") { input.article!.html = "<p>Body</p>"; input.article!.cover = "https://cdn.test/broken.png"; }
    vi.mocked(api.uploadAssetMultipart).mockRejectedValue(new Error("offline"));
    vi.mocked(api.uploadAssetByUrl).mockRejectedValue(new Error("offline"));
    expect(await publish_copy(input)).toMatchObject({ success: false, copy: { refused: { cause: "network", message: expect.stringMatching(/Could not upload .*?(broken.png|data URI)/) } } });
    expect(api.publishArticle).not.toHaveBeenCalled();
  });
  it("invalid and missing picture sources refuse with content cause", async () => {
    for (const html of ['<img alt="missing">', '<img src="">', '<img src="javascript:bad">', '<img src="data:text/plain;base64,YQ==">', '<img src="data:image/png;base64,???">']) {
      expect(await publish_copy(job(html))).toMatchObject({ copy: { refused: { cause: "content" } } });
    }
    expect(api.publishArticle).not.toHaveBeenCalled();
  });
  it("missing uploaded asset identity refuses before publication", async () => {
    vi.mocked(api.uploadAssetMultipart).mockResolvedValue({ id: "", path: "https://cdn.test/x" });
    expect(await publish_copy(job('<img src="/x.png">'))).toMatchObject({ copy: { refused: { cause: "network" } } });
    expect(api.publishArticle).not.toHaveBeenCalled();
  });
  it.each(['<figure>', '<figure class="image">', "<figure class='custom'>"])("normalizes raw image figures before publication: %s", async (open) => {
    await publish_copy(job(`${open}<img src="/x.png"></figure>`));
    expect(api.createDraft.mock.calls.at(-1)![0].content).toBe('<figure class="image"><img src="https://assets.matters.news/image.png"><figcaption></figcaption></figure>');
  });
  it("transport TypeError is a network refusal naming the image", async () => {
    vi.mocked(api.uploadAssetMultipart).mockRejectedValue(new TypeError("fetch failed"));
    expect(await publish_copy(job('<img src="/broken.png">'))).toMatchObject({ copy: { refused: { cause: "network", message: expect.stringContaining("/broken.png: fetch failed") } } });
    expect(api.publishArticle).not.toHaveBeenCalled();
  });
  it.each(["http://[broken", "javascript:alert(1)", ""])("invalid image URL %s refuses as content", async (src) => {
    expect(await publish_copy(job(`<img src="${src}">`))).toMatchObject({ copy: { refused: { cause: "content" } } });
    expect(api.publishArticle).not.toHaveBeenCalled();
  });
  it("deduplicates identical pictures while preserving alt and dollar signs", async () => {
    vi.mocked(api.uploadAssetMultipart).mockResolvedValue({ id: "asset", path: "https://assets.matters.news/$x.png" });
    const result = await uploadAndReplaceLocalImages('<img src="/x.png" alt="first"><img src="/x.png" alt="second">', job().post.url, draft.id);
    expect(api.uploadAssetMultipart).toHaveBeenCalledTimes(1);
    expect(result).toContain('alt="first"'); expect(result).toContain('alt="second"');
    expect(result.match(/\$x.png/g)).toHaveLength(2);
  });
  it("uploads percent-encoded data images as bytes", async () => {
    await uploadAndReplaceLocalImages('<img src="data:image/svg+xml,%3Csvg%3E%E6%95%B0%3C%2Fsvg%3E">', job().post.url, draft.id);
    expect(api.uploadAssetMultipart).toHaveBeenCalledWith("PHN2Zz7mlbA8L3N2Zz4=", "image.svg", "image/svg+xml", "embed", draft.id, "draft");
  });
  it("preserves core backlinks exactly once and adds none for either locale", async () => {
    for (const text of ["Originally published on Site.", "本文首发于Site。", "Body only"]) {
      storage.clear();
      const input = job(`<p>${text}</p>`); input.config = { add_canonical_link: true };
      await publish_copy(input);
      expect(api.createDraft.mock.calls.at(-1)![0].content).toBe(input.article!.html);
    }
  });
  it("refuses the recorded legacy core article before publishing or flattening TeX", async () => {
    const directory = join(import.meta.dirname, "../../test-fixtures/syndication-test-site");
    const html = readFileSync(join(directory, "moss-emitted-body.html"), "utf8");
    const input = job(html);
    expect(await publish_copy(input)).toMatchObject({ copy: { refused: { cause: "content", message: "This Matters copy is waiting for formula pictures. Its formulas must be sent as images before it can be published." } } });
    expect(api.publishArticle).not.toHaveBeenCalled();
  });
  it("keeps ordinary inline and multiline code unchanged", () => {
    const html = '<p><code>x &lt; y</code></p><pre><code>x % comment\ny</code></pre>';
    expect(normalizeHtmlForMatters(html)).toBe(html);
  });
  it.each([
    '<svg class="moss-math"><path /></svg>',
    '<svg class="moss-math"><title>x &lt; y</title></svg>',
    "<svg class='moss-math' aria-label='x'><path /></svg>",
    '<math><mi>x</mi></math>',
    '<code class="moss-math">$x$</code>',
    '<p>before <code data-moss-math="display">$$x % comment\ny$$</code> after</p>',
    '<p data-source-line="3"><code class=moss-math>$$x % comment&#10;y$$</code></p>',
  ])("refuses legacy formula markup without losing its content: %s", async (html) => {
    expect(await publish_copy(job(html))).toMatchObject({ copy: { refused: { cause: "content" } } });
    expect(api.publishArticle).not.toHaveBeenCalled();
    expect(api.createDraft).toHaveBeenCalledTimes(1);
  });

});

describe("article preparation integration", () => {
  it("preserves relative links, title removal, description and tags through publication", async () => {
    const input = job('<h1 class="moss-article-title">Title</h1><h1>Chapter</h1><a href="../other.html">Other</a>');
    await publish_copy(input);
    expect(api.createDraft).toHaveBeenLastCalledWith({
      id: draft.id, title: "Title", summary: "Summary", tags: ["tag"], cover: null,
      content: '<h2>Chapter</h2><a href="https://site.test/other.html">Other</a>',
    });
  });
  it("uploads a percent-encoded local cover and saves its asset ID before publishing", async () => {
    const input = job(); input.article!.cover = "/covers/%E5%9B%BE%20one.png";
    await publish_copy(input);
    expect(readSiteFile).toHaveBeenCalledWith("covers/图 one.png");
    expect(api.uploadAssetMultipart).toHaveBeenCalledWith("aW1hZ2U=", "图 one.png", "image/png", "cover", draft.id, "draft");
    expect(api.createDraft).toHaveBeenLastCalledWith(expect.objectContaining({ cover: "asset" }));
    expect(api.publishArticle.mock.invocationCallOrder[0]).toBeGreaterThan(api.uploadAssetMultipart.mock.invocationCallOrder[0]);
  });
  it("converts audio, uploads local bytes and preserves external streams", async () => {
    const input = job('<p data-source-line="1"><audio class="moss-embed-audio" controls><source src="../song.mp3" type="audio/mpeg">Fallback</audio></p><audio class="moss-embed-audio"><source src="https://cdn.test/song.mp3"></audio>');
    await publish_copy(input);
    expect(readSiteFile).toHaveBeenCalledWith("song.mp3");
    expect(api.uploadAssetMultipart).toHaveBeenCalledWith("aW1hZ2U=", "song.mp3", "audio/mpeg", "embedaudio", draft.id, "draft");
    const content = api.createDraft.mock.calls.at(-1)![0].content!;
    expect(content).toContain('<figure class="audio"><audio controls><source src="https://assets.matters.news/image.png" type="audio/mpeg"></audio><figcaption></figcaption></figure>');
    expect(content).toContain('src="https://cdn.test/song.mp3"');
    expect(content).not.toContain("Fallback");
    expect(content).not.toContain('<p data-source-line="1">');
  });
  it("retains the absolute audio stream when its optional byte upload fails", async () => {
    vi.mocked(api.uploadAssetMultipart).mockRejectedValue(new Error("offline"));
    expect(await publish_copy(job('<audio class="moss-embed-audio"><source src="../song.mp3"></audio>'))).toMatchObject({ success: true });
    expect(api.createDraft.mock.calls.at(-1)![0].content).toContain('src="https://site.test/song.mp3"');
  });
});

describe("lookup, edits and removal", () => {
  it("resolves article IDs directly even after the source becomes short", async () => {
    expect(await find_copy({ ...existing(), form: "short", article: null })).toMatchObject({ success: true, copy: previous });
    expect(api.fetchRemoteCopy).toHaveBeenCalledWith(article.id);
    expect(api.fetchDraft).not.toHaveBeenCalled();
  });
  it("legacy lookup may adopt one match but never guesses absence or ambiguity", async () => {
    expect(await find_copy(job())).toMatchObject({ success: false });
    const match = { ...article, title: "Title", content: `<a href="${job().post.url}">link</a>` } as any;
    vi.mocked(api.fetchAllArticles).mockResolvedValue({ userName: "alice", articles: [match] });
    expect(await find_copy(job())).toMatchObject({ success: true, copy: previous });
    vi.mocked(api.fetchAllArticles).mockResolvedValue({ userName: "alice", articles: [match, match] });
    expect(await find_copy(job())).toMatchObject({ success: false });
  });
  it("migrates a legacy short-hash ID through the article list", async () => {
    vi.mocked(api.fetchAllArticles).mockResolvedValue({ userName: "alice", articles: [article as any] });
    expect(await find_copy({ ...job(), previous: { id: "hash", url: previous.url } })).toMatchObject({ success: true, copy: previous });
    vi.mocked(api.fetchAllArticles).mockResolvedValue({ userName: "alice", articles: [] });
    expect(await find_copy({ ...job(), previous: { id: "hash", url: previous.url } })).toMatchObject({ success: false });
  });
  it("legacy draft lookup returns a published article or unknown, never a handoff", async () => {
    vi.mocked(api.fetchRemoteCopy).mockResolvedValue({ ...draft, __typename: "Draft" });
    expect(await find_copy(existing())).toMatchObject({ success: false });
    vi.mocked(api.fetchRemoteCopy).mockResolvedValue({ ...live, __typename: "Draft" });
    expect(await find_copy(existing())).toMatchObject({ success: true, copy: previous });
  });
  it("inactive states remain unknown while archives and missing nodes are absent", async () => {
    vi.mocked(api.fetchRemoteCopy).mockResolvedValue({ ...article, state: "pending" });
    expect(await find_copy(existing())).toMatchObject({ success: false });
    vi.mocked(api.fetchRemoteCopy).mockResolvedValue({ ...article, state: "archived" });
    expect(await find_copy(existing())).toMatchObject({ success: true, copy: null });
    vi.mocked(api.fetchRemoteCopy).mockResolvedValue(null);
    expect(await find_copy(existing())).toMatchObject({ success: true, copy: null });
  });
  it("updates the same article using editArticle and article assets", async () => {
    const input = existing(); input.article!.html = '<img src="/new.png">';
    expect(await update_copy(input)).toMatchObject({ success: true, copy: previous });
    expect(api.editArticle).toHaveBeenCalledWith(expect.objectContaining({ id: article.id, content: expect.stringContaining("assets.matters.news") }));
    expect(api.uploadAssetMultipart).toHaveBeenCalledWith("aW1hZ2U=", "new.png", "image/png", "embed", article.id, "article");
    expect(api.createDraft).not.toHaveBeenCalled(); expect(api.publishArticle).not.toHaveBeenCalled();
  });
  it.each([undefined, null])("removes the old article cover when the source cover is %s", async (cover) => {
    const input = existing(); input.article!.cover = cover;
    expect(await update_copy(input)).toMatchObject({ success: true, copy: previous });
    expect(api.editArticle).toHaveBeenCalledExactlyOnceWith({
      id: article.id, title: "Title", content: "<p>Body</p>", summary: "Summary", tags: ["tag"], cover: null,
    });
    expect(api.createDraft).not.toHaveBeenCalled();
    expect(api.publishArticle).not.toHaveBeenCalled();
    expect(api.uploadAssetMultipart).not.toHaveBeenCalled();
    expect(api.uploadAssetByUrl).not.toHaveBeenCalled();
  });
  it("replaces the article cover with its uploaded asset ID", async () => {
    const input = existing(); input.article!.cover = "/new-cover.png";
    expect(await update_copy(input)).toMatchObject({ success: true, copy: previous });
    expect(api.editArticle).toHaveBeenCalledWith(expect.objectContaining({ id: article.id, cover: "asset" }));
    expect(api.uploadAssetMultipart).toHaveBeenCalledWith("aW1hZ2U=", "new-cover.png", "image/png", "cover", article.id, "article");
    expect(api.createDraft).not.toHaveBeenCalled();
    expect(api.publishArticle).not.toHaveBeenCalled();
  });
  it("revision limit refuses with a final-revision explanation and no new copy", async () => {
    vi.mocked(api.editArticle).mockRejectedValue(new api.MattersRefusal("number of revisions reach limit", 200, "ARTICLE_REVISION_REACH_LIMIT"));
    expect(await update_copy(existing())).toMatchObject({ copy: { refused: { cause: "content", message: expect.stringContaining("can no longer be revised") } } });
    expect(api.createDraft).not.toHaveBeenCalled(); expect(api.publishArticle).not.toHaveBeenCalled();
  });
  it("unconfirmed revision throws and image failure prevents editing", async () => {
    vi.mocked(api.editArticle).mockResolvedValue({ ...article, id: "wrong" });
    await expect(update_copy(existing())).rejects.toThrow("revision");
    vi.mocked(api.editArticle).mockClear();
    vi.mocked(api.uploadAssetMultipart).mockRejectedValue(new Error("offline"));
    const input = existing(); input.article!.html = '<img src="/broken.png">';
    expect(await update_copy(input)).toMatchObject({ copy: { refused: { cause: "network" } } });
    expect(api.editArticle).not.toHaveBeenCalled();
  });
  it("moments cannot be revised", async () => {
    vi.mocked(api.fetchRemoteCopy).mockResolvedValue({ __typename: "Moment", id: "moment-id", shortHash: "mhash", state: "active" });
    expect(await update_copy(existing())).toMatchObject({ copy: { refused: { cause: "content" } } });
    expect(api.editArticle).not.toHaveBeenCalled();
  });
  it("delete without a form uses deleteMoment for moments", async () => {
    vi.mocked(api.fetchRemoteCopy).mockResolvedValue({ __typename: "Moment", id: "moment-id", shortHash: "mhash", state: "active" });
    const input = { ...existing(), form: undefined, article: null };
    expect(await delete_copy(input)).toMatchObject({ success: true, copy: null });
    expect(api.deleteMoment).toHaveBeenCalledExactlyOnceWith("moment-id"); expect(api.editArticle).not.toHaveBeenCalled();
    expect(record().phase).toBe("absent");
  });
  it("unconfirmed deletion throws", async () => {
    vi.mocked(api.fetchRemoteCopy).mockResolvedValue({ __typename: "Moment", id: "moment-id", shortHash: "mhash", state: "active" });
    vi.mocked(api.deleteMoment).mockResolvedValue({ id: "moment-id", state: "active" });
    await expect(delete_copy(existing())).rejects.toThrow("moment deletion");
  });
  it("archives long copies and explains retention", async () => {
    vi.mocked(api.editArticle).mockResolvedValue({ ...article, state: "archived" });
    expect(await delete_copy({ ...existing(), form: undefined })).toMatchObject({ success: true, message: expect.stringContaining("Matters retains the archive") });
    expect(api.editArticle).toHaveBeenCalledExactlyOnceWith({ id: article.id, state: "archived" });
    expect(await find_copy(job())).toMatchObject({ success: true, copy: null });
  });
  it("unconfirmed archival throws and unresolved drafts cannot be deleted", async () => {
    await expect(delete_copy(existing())).rejects.toThrow("article archive");
    vi.mocked(api.fetchRemoteCopy).mockResolvedValue({ ...draft, __typename: "Draft" });
    expect(await delete_copy(existing())).toMatchObject({ copy: { refused: { cause: "content" } } });
  });
  it("requires a previous ID for update or deletion", async () => {
    await expect(delete_copy(job())).rejects.toThrow("ID is missing");
    await expect(update_copy(job())).rejects.toThrow("ID is missing");
  });
  it("short and teaser copies are confirmed moments", async () => {
    for (const form of ["short", "teaser"] as const) expect(await publish_copy({ ...job(), form, parts: [{ text: "hello", links: [] }] })).toMatchObject({ success: true, copy: { id: "moment-id", url: "https://matters.town/m/mhash" } });
    vi.mocked(api.putMoment).mockResolvedValue({ id: "", shortHash: "" });
    await expect(publish_copy({ ...job(), form: "short", parts: [{ text: "hi", links: [] }] })).rejects.toThrow("moment's ID");
    expect(momentHtml('A < B\n\nhttps://a.test', ['https://a.test'])).toBe('<p>A &lt; B</p><p><a href="https://a.test">https://a.test</a></p>');
  });
});
