import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@symbiosis-lab/moss-api", () => ({ getSecret: vi.fn(async () => "app-pass") }));

import { delete_copy, find_copy, linkFacets, publish_copy, type CopyJob } from "../main";
import { recordKey } from "../atproto";

/** An in-memory data server: one repo, the calls the plugin makes. */
function fakePds(opts: { password?: string; maxText?: number } = {}) {
  const records = new Map<string, any>();
  const calls: string[] = [];
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  const fetchFn = vi.fn(async (url: string, init: any) => {
    const u = new URL(url);
    const method = u.pathname.replace("/xrpc/", "");
    calls.push(method);
    const body = init?.body ? JSON.parse(init.body) : {};
    switch (method) {
      case "com.atproto.server.createSession":
        if (body.password !== (opts.password ?? "app-pass")) return reply(401, { error: "AuthenticationRequired", message: "Invalid identifier or password" });
        return reply(200, { did: "did:plc:alex", handle: body.identifier, accessJwt: "jwt" });
      case "com.atproto.repo.createRecord": {
        if (records.has(body.rkey)) return reply(400, { error: "InvalidRequest", message: "Record already exists" });
        if ((body.record.text as string).length > (opts.maxText ?? 300)) return reply(400, { error: "InvalidRecord", message: "Record/text must not be longer than 300 graphemes" });
        records.set(body.rkey, body.record);
        return reply(200, { uri: `at://did:plc:alex/app.bsky.feed.post/${body.rkey}`, cid: `cid-${body.rkey}` });
      }
      case "com.atproto.repo.getRecord": {
        const rkey = u.searchParams.get("rkey")!;
        if (!records.has(rkey)) return reply(400, { error: "RecordNotFound", message: "Could not locate record" });
        return reply(200, { uri: `at://did:plc:alex/app.bsky.feed.post/${rkey}`, cid: `cid-${rkey}`, value: records.get(rkey) });
      }
      case "com.atproto.repo.deleteRecord":
        records.delete(body.rkey);
        return reply(200, {});
    }
    return reply(404, { error: "MethodNotImplemented" });
  });
  vi.stubGlobal("fetch", fetchFn);
  return { records, calls };
}

function job(over: Partial<CopyJob> = {}): CopyJob {
  return {
    op: "publish",
    channel: "bluesky",
    idempotency_key: "0123456789abcdef0123456789abcdef",
    post: { url: "https://notes.example.org/notes/a/", source_path: "notes/a.md", title: "", lang: "en", date: "2026-11-06T14:32:00Z" },
    form: "short",
    parts: [{ text: "Autumn's first hotpot https://example.org", links: ["https://example.org"] }],
    config: { handle: "alex.example.org", service: "http://pds.test" },
    ...over,
  };
}

beforeEach(() => vi.unstubAllGlobals());

describe("publish_copy", () => {
  it("posts the text with its link marked up and returns the copy's address", async () => {
    const pds = fakePds();
    const r = await publish_copy(job());
    expect(r.success).toBe(true);
    expect(r.copy?.url).toMatch(/^https:\/\/bsky\.app\/profile\/alex\.example\.org\/post\/[2-7a-z]{13}$/);
    const [record] = [...pds.records.values()];
    expect(record.text).toBe("Autumn's first hotpot https://example.org");
    expect(record.langs).toEqual(["en"]);
    expect(record.facets[0].features[0].uri).toBe("https://example.org");
  });

  it("posts a thread as replies, each to the one before and all to the first", async () => {
    const pds = fakePds();
    const r = await publish_copy(job({ form: "thread", parts: [{ text: "One.", links: [] }, { text: "Two.", links: [] }, { text: "Three.", links: [] }] }));
    expect(r.copy?.parts).toHaveLength(2);
    const [first, second, third] = [...pds.records.values()];
    expect(first.reply).toBeUndefined();
    expect(second.reply.root.uri).toBe(r.copy?.id);
    expect(third.reply.parent.uri).toBe(r.copy?.parts?.[0].id);
    expect(third.reply.root.uri).toBe(r.copy?.id);
  });

  it("is safe to retry: a second send lands on the records the first made", async () => {
    const pds = fakePds();
    const first = await publish_copy(job({ form: "thread", parts: [{ text: "One.", links: [] }, { text: "Two.", links: [] }] }));
    const again = await publish_copy(job({ form: "thread", parts: [{ text: "One.", links: [] }, { text: "Two.", links: [] }] }));
    expect(again.copy?.id).toBe(first.copy?.id);
    expect(pds.records.size).toBe(2);
  });

  it("attaches a link card to a teaser", async () => {
    const pds = fakePds();
    await publish_copy(job({ form: "teaser", teaser: { title: "Autumn", description: "About the season.", url: "https://notes.example.org/a/" } }));
    const [record] = [...pds.records.values()];
    expect(record.embed.external).toEqual({ uri: "https://notes.example.org/a/", title: "Autumn", description: "About the season." });
  });

  it("names the kind of refusal: a wrong password is auth, a text the server will not take is content", async () => {
    fakePds({ password: "other" });
    expect((await publish_copy(job())).copy?.refused?.cause).toBe("auth");
    fakePds({ maxText: 5 });
    const r = await publish_copy(job());
    expect(r.success).toBe(false);
    expect(r.copy?.refused).toEqual({ cause: "content", message: "Record/text must not be longer than 300 graphemes" });
  });
});

describe("find_copy and delete_copy", () => {
  it("finds a copy an interrupted send made, and reports none when there is none", async () => {
    fakePds();
    expect((await find_copy(job({ op: "find" }))).copy).toBeNull();
    const posted = await publish_copy(job());
    expect((await find_copy(job({ op: "find" }))).copy?.id).toBe(posted.copy?.id);
  });

  it("removes every part of a thread", async () => {
    const pds = fakePds();
    const posted = await publish_copy(job({ form: "thread", parts: [{ text: "One.", links: [] }, { text: "Two.", links: [] }] }));
    const r = await delete_copy(job({ op: "delete", previous: { id: posted.copy!.id!, url: posted.copy!.url!, parts: posted.copy!.parts! } }));
    expect(r.success).toBe(true);
    expect(pds.records.size).toBe(0);
  });

  it("removes a copy whose record lists no parts", async () => {
    const pds = fakePds();
    const posted = await publish_copy(job());
    const r = await delete_copy(job({ op: "delete", previous: { id: posted.copy!.id!, url: posted.copy!.url! } }));
    expect(r.success).toBe(true);
    expect(pds.records.size).toBe(0);
  });
});

describe("record keys and facets", () => {
  it("a record key is a 13-character TID, the same for a part on every send and different per part", () => {
    const a = recordKey("0123456789abcdef", "2026-11-06T14:32:00Z", 0);
    expect(a).toMatch(/^[2-7a-z]{13}$/);
    expect(recordKey("0123456789abcdef", "2026-11-06T14:32:00Z", 0)).toBe(a);
    expect(recordKey("0123456789abcdef", "2026-11-06T14:32:00Z", 1)).not.toBe(a);
    expect(recordKey("fedcba9876543210", "2026-11-06T14:32:00Z", 0)).not.toBe(a);
  });

  it("facet offsets count UTF-8 bytes, so a link after Chinese text is marked where it is", () => {
    const text = "秋天 https://example.org";
    const [facet] = linkFacets(text, ["https://example.org"]) as any[];
    expect(facet.index).toEqual({ byteStart: 7, byteEnd: 7 + "https://example.org".length });
  });
});
