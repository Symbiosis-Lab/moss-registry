import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const secrets: Record<string, string | null> = {};
const panel = { pages: [] as string[], on: {} as Record<string, () => void>, opened: [] as string[], closed: Promise.resolve({ type: "user" }), app: true, waits: [] as string[] };
vi.mock("@symbiosis-lab/moss-api", () => ({
  getSecret: vi.fn(async (k: string) => secrets[k] ?? null),
  openBrowser: vi.fn(async (url: string) => {
    if (!panel.app) throw new Error("open_action_panel needs the moss app");
    panel.opened.push(url);
    return { closed: panel.closed };
  }),
  openBrowserWithHtml: vi.fn(async (html: string) => { panel.pages.push(html); }),
  onEvent: vi.fn(async (name: string, handler: () => void) => { panel.on[name] = handler; return () => {}; }),
  startTask: vi.fn(async () => ({ awaiting: async (directive: string, venue: string) => { panel.waits.push(`${directive} in ${venue}`); }, succeeded: async () => {} })),
}));

import { copy_account, delete_copy, find_copy, publish_copy, type CopyJob } from "../main";
import { authorization, percent } from "../oauth1";

const CREDS = { api_key: "ck", api_key_secret: "cs&+/", access_token: "tok", access_token_secret: "ts=1" };

/** Node's own HMAC over the OAuth base string: an implementation independent of the plugin's. */
function expectedSignature(method: string, url: string, header: string, consumerSecret: string, tokenSecret: string) {
  const oauth = Object.fromEntries([...header.slice(6).matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, decodeURIComponent(v)]));
  const u = new URL(url);
  const params = [...u.searchParams, ...Object.entries(oauth).filter(([k]) => k !== "oauth_signature")].map(([k, v]) => [percent(k), percent(v)])
    .sort((a, b) => (a[0] + "\0" + a[1] < b[0] + "\0" + b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`);
  const base = `${method}&${percent(u.origin + u.pathname)}&${percent(params.join("&"))}`;
  return { given: oauth.oauth_signature, want: createHmac("sha1", `${percent(consumerSecret)}&${percent(tokenSecret)}`).update(base).digest("base64") };
}

/** An in-memory X: one account, the v2 calls the plugin makes, each request's signature checked. */
function fakeX(opts: { failAt?: number; status?: number; type?: string } = {}) {
  const posts = new Map<string, { id: string; text: string; reply?: string }>();
  const calls: string[] = [];
  const shortLinks = new Map<string, string>();
  let next = 1000;
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      const u = new URL(url);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${u.pathname}${u.search}`);
      const sig = expectedSignature(method, url, init.headers.authorization ?? "", CREDS.api_key_secret, CREDS.access_token_secret);
      if (sig.given !== sig.want) return reply(401, { title: "Unauthorized", detail: "Unauthorized", type: "about:blank", status: 401 });
      if (method === "POST" && u.pathname === "/2/tweets") {
        if (opts.failAt === posts.size) return reply(opts.status ?? 403, { title: "Forbidden", detail: "You are not allowed to create a Tweet with duplicate content.", type: opts.type ?? "about:blank", status: opts.status ?? 403 });
        const body = JSON.parse(init.body);
        if (body.reply && !posts.has(body.reply.in_reply_to_tweet_id)) return reply(400, { title: "Invalid Request", detail: "reply target missing", type: "https://api.x.com/2/problems/invalid-request" });
        const id = String(next++);
        posts.set(id, { id, text: body.text, reply: body.reply?.in_reply_to_tweet_id });
        return reply(201, { data: { id, text: body.text.replace(/https?:\/\/\S+/g, "https://t.co/abc123") } });
      }
      if (method === "DELETE") {
        const id = u.pathname.split("/").pop()!;
        if (!posts.delete(id)) return reply(404, { title: "Not Found Error", detail: "Could not find post", type: "https://api.x.com/2/problems/resource-not-found" });
        return reply(200, { data: { deleted: true } });
      }
      if (u.pathname === "/2/users/me") return reply(200, { data: { id: "42", name: "Alex", username: "alex" } });
      if (u.pathname === "/2/users/42/tweets") {
        // As X answers: `& < >` escaped, each link replaced by its own short one, replies and links' addresses only when asked for.
        const fields = (u.searchParams.get("tweet.fields") ?? "").split(",");
        return reply(200, {
          data: [...posts.values()].reverse().map((p) => {
            const urls: { url: string; expanded_url: string }[] = [];
            const text = p.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/https?:\/\/\S+/g, (link) => {
              const short = `https://t.co/${shortLinks.get(link) ?? shortLinks.set(link, `s${shortLinks.size}`).get(link)}`;
              urls.push({ url: short, expanded_url: link });
              return short;
            });
            return {
              id: p.id,
              text,
              ...(fields.includes("referenced_tweets") && p.reply ? { referenced_tweets: [{ type: "replied_to", id: p.reply }] } : {}),
              ...(fields.includes("entities") && urls.length ? { entities: { urls } } : {}),
            };
          }),
        });
      }
      return reply(404, { title: "Not Found Error" });
    }),
  );
  return { posts, calls };
}

function job(over: Partial<CopyJob> = {}): CopyJob {
  return {
    op: "publish",
    channel: "xcom",
    idempotency_key: "0123456789abcdef0123456789abcdef",
    post: { url: "https://notes.example.org/notes/a/", source_path: "notes/a.md", title: "", lang: "en", date: "2026-11-06T14:32:00Z" },
    form: "short",
    parts: [{ text: "Autumn's first hotpot https://example.org/river", links: ["https://example.org/river"] }],
    config: { api: "http://127.0.0.1:9/" },
    ...over,
  };
}

const thread = [{ text: "One.", links: [] }, { text: "Two.", links: [] }, { text: "Three.", links: [] }];

beforeEach(() => {
  vi.unstubAllGlobals();
  Object.assign(secrets, CREDS);
  Object.assign(panel, { pages: [], on: {}, opened: [], closed: Promise.resolve({ type: "user" }), app: true, waits: [] });
});

describe("publish_copy without API keys", () => {
  const noKeys = () => { for (const k of Object.keys(CREDS)) secrets[k] = null; };
  const composer = (text: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;

  it("opens X's composer filled with the post, and waits for the author", async () => {
    noKeys();
    const x = fakeX();
    let close!: () => void;
    panel.closed = new Promise((resolve) => { close = () => resolve({ type: "user" }); });
    let settled = false;
    const sent = publish_copy(job()).then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 10));
    expect(panel.opened).toEqual([composer("Autumn's first hotpot https://example.org/river")]);
    expect(panel.waits).toEqual(["post in X"]);
    expect(settled).toBe(false);
    close();
    expect(await sent).toEqual({ success: true, copy: { handoff: { text: "", open_url: composer("Autumn's first hotpot https://example.org/river") } } });
    expect(x.calls).toEqual([]);
  });

  it("hands back a thread's later parts to add as replies", async () => {
    noKeys();
    const r = await publish_copy(job({ form: "thread", parts: thread }));
    expect(panel.opened).toEqual([composer("One.")]);
    expect(r.copy?.handoff).toEqual({ text: "Two.\n\nThree.", open_url: composer("One.") });
  });

  it("gives the composer's address when there is no app to open it in", async () => {
    noKeys();
    panel.app = false;
    const r = await publish_copy(job());
    expect(r.copy?.handoff?.open_url).toBe(composer("Autumn's first hotpot https://example.org/river"));
  });
});

describe("oauth1", () => {
  it("signs X's worked example as its documentation does, for either host", async () => {
    const creds = { consumerKey: "xvz1evFS4wEEPTGEFPHBog", consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw", token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE" };
    // The example's status is a form field, so it is signed like a query parameter.
    const query = "?include_entities=true&status=" + percent("Hello Ladies + Gentlemen, a signed OAuth request!");
    const sign = (host: string) => authorization("POST", `https://${host}/1.1/statuses/update.json${query}`, creds, "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", 1318622958);
    expect(await sign("api.x.com")).toContain(`oauth_signature="${percent("Ls93hJiZbQ3akF3HF3x1Bz8/zU4=")}"`);
    expect(await sign("api.twitter.com")).toContain(`oauth_signature="${percent("hCtSmYh+iHYCEqBWrE7C7hYmtUk=")}"`);
  });
});

describe("publish_copy", () => {
  it("posts the text and returns the post's address", async () => {
    const x = fakeX();
    const r = await publish_copy(job());
    expect(r).toEqual({ success: true, copy: { id: "1000", url: "https://x.com/i/status/1000", parts: [] } });
    expect(x.posts.get("1000")?.text).toBe("Autumn's first hotpot https://example.org/river");
  });

  it("posts a thread as replies, each to the part before it", async () => {
    const x = fakeX();
    const r = await publish_copy(job({ form: "thread", parts: thread }));
    expect([...x.posts.values()].map((p) => p.reply)).toEqual([undefined, "1000", "1001"]);
    expect(r.copy?.parts).toEqual([{ id: "1001", url: "https://x.com/i/status/1001" }, { id: "1002", url: "https://x.com/i/status/1002" }]);
  });

  it("takes a thread refused part way down again, so the next run sends it whole", async () => {
    const x = fakeX({ failAt: 2 });
    const r = await publish_copy(job({ form: "thread", parts: thread }));
    expect(r.copy?.refused).toEqual({ cause: "content", message: "You are not allowed to create a Tweet with duplicate content." });
    expect(x.posts.size).toBe(0);
  });

  it("names what kind of refusal each answer is", async () => {
    const causes: [number, string, string][] = [
      [401, "about:blank", "auth"],
      [403, "https://api.x.com/2/problems/client-forbidden", "auth"],
      [403, "https://api.x.com/2/problems/unsupported-authentication", "auth"],
      [403, "about:blank", "content"],
      [400, "https://api.x.com/2/problems/invalid-request", "content"],
      [402, "about:blank", "rate"],
      [429, "https://api.x.com/2/problems/usage-capped", "rate"],
    ];
    for (const [status, type, cause] of causes) {
      fakeX({ failAt: 0, status, type });
      expect((await publish_copy(job())).copy?.refused?.cause, `${status} ${type}`).toBe(cause);
    }
  });

  it("says missing credentials are a sign-in problem, without calling X", async () => {
    const x = fakeX();
    secrets.access_token_secret = null;
    const r = await publish_copy(job());
    expect(r.copy?.refused?.cause).toBe("auth");
    expect(x.calls).toEqual([]);
  });

  it("sends the credentials nowhere but X or a local test server", async () => {
    const x = fakeX();
    const r = await publish_copy(job({ config: { api: "https://api.example.net" } }));
    expect(r.copy?.refused?.cause).toBe("auth");
    expect(x.calls).toEqual([]);
  });

  it("throws when X fails without saying why, since a post may exist", async () => {
    const x = fakeX({ failAt: 1, status: 503 });
    await expect(publish_copy(job({ form: "thread", parts: thread }))).rejects.toThrow();
    expect(x.posts.size).toBe(1);
  });
});

describe("copy_account", () => {
  it("names the account by its id with API keys, and none without them", async () => {
    const x = fakeX();
    expect(await copy_account({ channel: "xcom", config: job().config })).toEqual({ success: true, copy: { account: "42" } });
    for (const k of Object.keys(CREDS)) secrets[k] = null;
    expect(await copy_account({ channel: "xcom", config: job().config })).toEqual({ success: true });
    expect(x.calls.filter((c) => c.includes("/2/users/me"))).toHaveLength(1);
  });
});

describe("find_copy", () => {
  it("finds the copy by its text though X has escaped it and replaced its link", async () => {
    const x = fakeX();
    const fish = job({ op: "find", parts: [{ text: "Fish & chips <by the sea> https://example.org/river", links: [] }] });
    await publish_copy(fish);
    expect(await find_copy(fish)).toEqual({ success: true, copy: { id: "1000", url: "https://x.com/i/status/1000", parts: [] } });
    // The look-up's query is signed too, or X refuses it.
    expect(x.calls).toContain("GET /2/users/42/tweets?max_results=20&tweet.fields=referenced_tweets,entities");
  });

  it("tells posts apart by their links' addresses, though X shows every link as its own short one", async () => {
    fakeX();
    const photo = (link: string) => job({ op: "find", parts: [{ text: `Photo of the day ${link}`, links: [link] }] });
    await publish_copy(photo("https://example.org/a"));
    expect((await find_copy(photo("https://example.org/b"))).success).toBe(false);
    await publish_copy(photo("https://example.org/b"));
    expect((await find_copy(photo("https://example.org/b"))).copy?.id).toBe("1001");
  });

  it("finds a whole thread, each part a reply to the one before", async () => {
    fakeX();
    await publish_copy(job({ form: "thread", parts: thread }));
    expect((await find_copy(job({ op: "find", form: "thread", parts: thread }))).copy).toEqual({
      id: "1000",
      url: "https://x.com/i/status/1000",
      parts: [{ id: "1001", url: "https://x.com/i/status/1001" }, { id: "1002", url: "https://x.com/i/status/1002" }],
    });
  });

  // moss posts again on "none"; the copy may be older than the posts read, or its text edited since.
  it("cannot tell when none of the latest posts is the copy", async () => {
    fakeX();
    const r = await find_copy(job({ op: "find" }));
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/retry-copies/);
  });

  it("says what each way out of an uncertain copy costs", async () => {
    fakeX();
    const r = await find_copy(job({ op: "find" }));
    expect(r.message).toMatch(/syndicated:.*first post/);
    expect(r.message).toMatch(/retry-copies.*twice/);
  });

  it("does not take posts with the parts' words for the thread unless each replies to the part before", async () => {
    fakeX();
    for (const part of thread) await publish_copy(job({ parts: [part] }));
    expect((await find_copy(job({ op: "find", form: "thread", parts: thread }))).success).toBe(false);
  });

  it("cannot tell when the copy has more replies than the post has parts, as when it was shortened after the send", async () => {
    fakeX();
    await publish_copy(job({ form: "thread", parts: thread }));
    expect((await find_copy(job({ op: "find", form: "short", parts: thread.slice(0, 1) }))).success).toBe(false);
    expect((await find_copy(job({ op: "find", form: "thread", parts: thread.slice(0, 2) }))).success).toBe(false);
  });

  it("cannot tell when a thread is only partly there, and leaves its posts alone", async () => {
    const x = fakeX();
    await publish_copy(job({ form: "thread", parts: thread.slice(0, 2) }));
    expect((await find_copy(job({ op: "find", form: "thread", parts: thread }))).success).toBe(false);
    expect(x.posts.size).toBe(2);
  });
});

describe("delete_copy", () => {
  it("removes a copy sent without its later parts", async () => {
    const x = fakeX();
    await publish_copy(job());
    expect((await delete_copy(job({ op: "delete", previous: { id: "1000", url: "u" } }))).success).toBe(true);
    expect(x.posts.size).toBe(0);
  });

  it("removes every post of the copy, last part first, and takes one already gone as removed", async () => {
    const x = fakeX();
    const posted = (await publish_copy(job({ form: "thread", parts: thread }))).copy!;
    x.posts.delete("1002");
    const r = await delete_copy(job({ op: "delete", previous: { id: posted.id!, url: posted.url!, parts: posted.parts! } }));
    expect(r.success).toBe(true);
    expect(x.posts.size).toBe(0);
    expect(x.calls.filter((c) => c.startsWith("DELETE"))).toEqual(["DELETE /2/tweets/1002", "DELETE /2/tweets/1001", "DELETE /2/tweets/1000"]);
  });

  it("has nothing to remove when the delete names no copy", async () => {
    const x = fakeX();
    expect((await delete_copy(job({ op: "delete", previous: null }))).success).toBe(true);
    expect(x.calls.filter((c) => c.startsWith("DELETE"))).toEqual([]);
  });

  it("says a copy listed by its address is removed on X, with or without API keys", async () => {
    const x = fakeX();
    const listed = "https://x.com/alex/article/1790000000000000000";
    for (const keys of [CREDS, {}]) {
      for (const k of Object.keys(CREDS)) secrets[k] = (keys as Record<string, string>)[k] ?? null;
      const r = await delete_copy(job({ op: "delete", previous: { id: listed, url: listed } }));
      expect(r.success).toBe(false);
      expect(r.copy?.refused).toEqual({ cause: "content", message: `remove it on X: ${listed}` });
    }
    expect(x.calls).toEqual([]);
  });
});

describe("an article", () => {
  const article = { title: "On rivers", html: "<h1>On rivers</h1><p>Long.</p>" };
  const editor = "https://x.com/compose/articles";

  it("is shown to copy, then X's article editor opens, with or without API keys", async () => {
    const x = fakeX();
    const sent = publish_copy(job({ form: "long", parts: [], article }));
    await new Promise((r) => setTimeout(r, 10));
    expect(panel.pages).toHaveLength(1);
    expect(panel.pages[0]).toContain("Copy and open X");
    expect(panel.waits).toEqual(["paste and publish the article in X"]);
    expect(panel.opened).toEqual([]);
    panel.on["article-handoff:copied"]();
    expect(await sent).toEqual({ success: true, copy: { handoff: { text: "", open_url: editor } } });
    expect(panel.opened).toEqual([editor]);
    expect(x.calls).toEqual([]);
  });

  it("waits to be listed under syndicated:, and is never looked up among posts", async () => {
    const x = fakeX();
    expect(await find_copy(job({ op: "find", form: "long", parts: [], article }))).toEqual({ success: true, copy: { handoff: { text: "", open_url: editor } } });
    expect(x.calls).toEqual([]);
  });

  it("is refused when the job carries none, and nothing is posted in its place", async () => {
    const x = fakeX();
    const r = await publish_copy(job({ form: "long", parts: [], article: null }));
    expect(r.copy?.refused?.cause).toBe("content");
    expect(panel.pages).toEqual([]);
    expect(x.calls).toEqual([]);
  });
});

describe("find_copy for a copy whose text is no longer known", () => {
  it("says nothing is known, without reading the account's posts", async () => {
    const x = fakeX();
    for (const parts of [undefined, []]) {
      const r = await find_copy(job({ op: "find", form: undefined, parts }));
      expect(r.success).toBe(false);
      expect(r.copy).toBeUndefined();
    }
    expect(x.calls).toEqual([]);
  });
});
