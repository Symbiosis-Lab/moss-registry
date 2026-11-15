import { beforeEach, describe, expect, it, vi } from "vitest";

const secrets: Record<string, string | null> = {};
vi.mock("@symbiosis-lab/moss-api", () => ({ getSecret: vi.fn(async (k: string) => secrets[k] ?? null) }));

import { delete_copy, littleText, publish_copy, update_copy, type CopyJob } from "../main";

/** Reads little text back to what was meant; an unescaped reserved character is markup, so it is refused. */
function unescape(s: string): string | null {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") out += s[++i] ?? "";
    else if ("|{}@[]()<>#*_~".includes(s[i])) return null;
    else out += s[i];
  }
  return out;
}

/** An in-memory Posts API: one member, the calls the plugin makes, with the headers LinkedIn requires. */
function fakeLinkedin(opts: { token?: string; failWith?: number; noId?: boolean; userinfo?: number } = {}) {
  const posts = new Map<string, any>();
  const calls: string[] = [];
  let next = 6844785523593134000;
  const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) => ({
    ok: status < 400,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      const u = new URL(url);
      const method = init?.method ?? "GET";
      const h = init.headers;
      calls.push(`${method} ${u.pathname}${h["X-RestLi-Method"] ? ` ${h["X-RestLi-Method"]}` : ""}`);
      if (h.authorization !== `Bearer ${opts.token ?? "token"}`) return reply(401, { status: 401, message: "Invalid access token" });
      if (u.pathname === "/v2/userinfo") return opts.userinfo ? reply(opts.userinfo, { message: "Service unavailable" }) : reply(200, { sub: "782bbtaQ", name: "Alex" });
      if (!/^\d{6}$/.test(h["Linkedin-Version"] ?? "") || h["X-Restli-Protocol-Version"] !== "2.0.0") return reply(400, { status: 400, message: "A version header is missing" });
      if (opts.failWith) return reply(opts.failWith, { status: opts.failWith, message: "Content is a duplicate" });
      // A URN in the path must be encoded.
      if (/^\/rest\/posts\/.*:/.test(u.pathname)) return reply(400, { status: 400, message: "INVALID_URN_TYPE" });
      const urn = decodeURIComponent(u.pathname.replace(/^\/rest\/posts\/?/, ""));
      if (method === "POST" && !urn) {
        const body = JSON.parse(init.body);
        const text = unescape(body.commentary);
        if (text === null) return reply(422, { status: 422, message: "commentary has unescaped markup" });
        if (body.author !== "urn:li:person:782bbtaQ") return reply(403, { status: 403, message: "not the member's own author" });
        const id = `urn:li:share:${next++}`;
        posts.set(id, { ...body, text });
        return reply(201, undefined, opts.noId ? {} : { "x-restli-id": id });
      }
      if (method === "POST" && h["X-RestLi-Method"] === "PARTIAL_UPDATE") {
        if (!posts.has(urn)) return reply(404, { status: 404, message: "Not found" });
        const text = unescape(JSON.parse(init.body).patch.$set.commentary);
        if (text === null) return reply(422, { status: 422, message: "commentary has unescaped markup" });
        posts.get(urn).text = text;
        return reply(204);
      }
      if (method === "DELETE" && h["X-RestLi-Method"] === "DELETE") {
        posts.delete(urn);
        return reply(204);
      }
      return reply(404, { status: 404, message: "Not found" });
    }),
  );
  return { posts, calls };
}

function job(over: Partial<CopyJob> = {}): CopyJob {
  return {
    op: "publish",
    channel: "linkedin",
    idempotency_key: "0123456789abcdef0123456789abcdef",
    post: { url: "https://notes.example.org/notes/a/", source_path: "notes/a.md", title: "", lang: "en", date: "2026-11-06T14:32:00Z" },
    form: "short",
    parts: [{ text: "Autumn's first hotpot (by the river) #food https://example.org/a_b", links: ["https://example.org/a_b"] }],
    config: { api: "http://127.0.0.1:9/" },
    ...over,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  secrets.access_token = "token";
});

describe("littleText", () => {
  it("escapes every character LinkedIn reads as markup, and nothing else", () => {
    expect(littleText("a|b{c}d@e[f]g(h)i<j>k#l\\m*n_o~p")).toBe("a\\|b\\{c\\}d\\@e\\[f\\]g\\(h\\)i\\<j\\>k\\#l\\\\m\\*n\\_o\\~p");
    expect(littleText("Plain words, and 100%!")).toBe("Plain words, and 100%!");
  });
});

describe("publish_copy", () => {
  it("posts the text publicly as the member, and returns the post's address", async () => {
    const li = fakeLinkedin();
    const r = await publish_copy(job());
    const urn = "urn:li:share:6844785523593134000";
    expect(r).toEqual({ success: true, copy: { id: urn, url: `https://www.linkedin.com/feed/update/${urn}/`, parts: [] } });
    const post = li.posts.get(urn);
    expect(post.text).toBe("Autumn's first hotpot (by the river) #food https://example.org/a_b");
    expect([post.visibility, post.lifecycleState, post.distribution.feedDistribution]).toEqual(["PUBLIC", "PUBLISHED", "MAIN_FEED"]);
    expect(post.content).toBeUndefined();
  });

  it("sends a teaser with an article card for the original", async () => {
    const li = fakeLinkedin();
    const teaser = { title: "On autumn", description: "Why the season reads as an ending.", url: "https://notes.example.org/essays/on-autumn/" };
    await publish_copy(job({ form: "teaser", teaser, parts: [{ text: `On autumn\n\nWhy the season reads as an ending.\n\n${teaser.url}`, links: [teaser.url] }] }));
    expect([...li.posts.values()][0].content).toEqual({ article: { source: teaser.url, title: "On autumn", description: "Why the season reads as an ending." } });
  });

  it("names what kind of refusal each answer is", async () => {
    for (const [status, cause] of [[401, "auth"], [403, "auth"], [422, "content"], [400, "content"], [429, "rate"]] as const) {
      fakeLinkedin({ failWith: status });
      expect((await publish_copy(job())).copy?.refused?.cause, String(status)).toBe(cause);
    }
  });

  it("says a missing token is a sign-in problem, without calling LinkedIn", async () => {
    const li = fakeLinkedin();
    secrets.access_token = null;
    expect((await publish_copy(job())).copy?.refused?.cause).toBe("auth");
    expect(li.calls).toEqual([]);
  });

  it("sends the token nowhere but LinkedIn or a local test server", async () => {
    const li = fakeLinkedin();
    expect((await publish_copy(job({ config: { api: "https://api.example.net" } }))).copy?.refused?.cause).toBe("auth");
    expect(li.calls).toEqual([]);
  });

  it("answers a failure before anything is posted as a refusal, so the copy is sent again", async () => {
    const li = fakeLinkedin({ userinfo: 503 });
    expect((await publish_copy(job())).copy?.refused?.cause).toBe("network");
    expect(li.posts.size).toBe(0);
  });

  it("throws when the post may exist but its id is unknown", async () => {
    fakeLinkedin({ noId: true });
    await expect(publish_copy(job())).rejects.toThrow(/did not say its id/);
    fakeLinkedin({ failWith: 500 });
    await expect(publish_copy(job())).rejects.toThrow();
  });
});

describe("update_copy", () => {
  it("edits the copy's text in place and keeps its address", async () => {
    const li = fakeLinkedin();
    const posted = (await publish_copy(job())).copy!;
    const r = await update_copy(job({ op: "update", parts: [{ text: "Edited (twice) #food", links: [] }], previous: { id: posted.id!, url: posted.url!, parts: [] } }));
    expect(r.copy).toEqual({ id: posted.id, url: posted.url, parts: [] });
    expect(li.posts.get(posted.id!).text).toBe("Edited (twice) #food");
  });

  it("refuses an edit that names no copy", async () => {
    fakeLinkedin();
    const r = await update_copy(job({ op: "update", parts: [{ text: "Edited", links: [] }], previous: null }));
    expect(r.success).toBe(false);
    expect(r.copy?.refused?.message).toMatch(/no copy to edit/);
  });
});

describe("delete_copy", () => {
  it("removes the copy", async () => {
    const li = fakeLinkedin();
    const posted = (await publish_copy(job())).copy!;
    expect((await delete_copy(job({ op: "delete", previous: { id: posted.id!, url: posted.url!, parts: [] } }))).success).toBe(true);
    expect(li.posts.size).toBe(0);
    expect(li.calls.at(-1)).toBe(`DELETE /rest/posts/${encodeURIComponent(posted.id!)} DELETE`);
  });

  it("has nothing to remove when the delete names no copy", async () => {
    const li = fakeLinkedin();
    expect((await delete_copy(job({ op: "delete", previous: null }))).success).toBe(true);
    expect(li.calls.filter((c) => c.startsWith("DELETE"))).toEqual([]);
  });
});
