import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@symbiosis-lab/moss-api", () => ({ getSecret: vi.fn(async () => "token") }));

import { delete_copy, find_copy, plainText, publish_copy, update_copy, type CopyJob } from "../main";

/** A status as servers render it: links as anchors whose visible text is shortened. */
const html = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/\n\n/g, "</p><p>")
    .replace(/https?:\/\/(\S+)/g, (url, rest) => `<a href="${url}" rel="nofollow noopener" target="_blank"><span class="invisible">https://</span><span class="ellipsis">${rest.slice(0, 20)}</span></a>`);

/** An in-memory server: one account, the client API calls the plugin makes. */
function fakeServer(opts: { token?: string; maxText?: number; failAt?: number; status?: number } = {}) {
  const statuses = new Map<string, any>();
  const calls: string[] = [];
  let next = 1;
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  const fetchFn = vi.fn(async (url: string, init: any) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${u.pathname}`);
    if (init.headers.authorization !== `Bearer ${opts.token ?? "token"}`) return reply(401, { error: "The access token is invalid" });
    const body = init?.body ? JSON.parse(init.body) : {};
    const id = u.pathname.split("/").pop()!;
    if (method === "POST" && u.pathname === "/api/v1/statuses") {
      if (opts.failAt === statuses.size) return reply(opts.status ?? 422, { error: "Validation failed: Text character limit of 500 exceeded" });
      if (body.status.length > (opts.maxText ?? 500)) return reply(422, { error: "Validation failed: Text character limit of 500 exceeded" });
      const s = { id: String(next++), url: `https://example.social/@alex/${next - 1}`, uri: "", content: `<p>${html(body.status)}</p>`, in_reply_to_id: body.in_reply_to_id ?? null, account: { id: "7" }, language: body.language, key: init.headers["Idempotency-Key"] };
      statuses.set(s.id, s);
      return reply(200, s);
    }
    if (method === "PUT") {
      const s = statuses.get(id);
      if (!s) return reply(404, { error: "Record not found" });
      s.content = `<p>${html(body.status)}</p>`;
      return reply(200, s);
    }
    if (method === "DELETE") {
      if (!statuses.delete(id)) return reply(404, { error: "Record not found" });
      return reply(200, {});
    }
    if (u.pathname === "/api/v1/accounts/verify_credentials") return reply(200, { id: "7" });
    if (u.pathname === "/api/v1/accounts/7/statuses") return reply(200, [...statuses.values()].reverse());
    if (method === "GET" && u.pathname.endsWith("/context")) {
      const root = u.pathname.split("/")[4];
      const below = (id: string): any[] => [...statuses.values()].filter((s) => s.in_reply_to_id === id).flatMap((s) => [s, ...below(s.id)]);
      return reply(200, { ancestors: [], descendants: below(root) });
    }
    return reply(404, { error: "not found" });
  });
  vi.stubGlobal("fetch", fetchFn);
  return { statuses, calls };
}

function job(over: Partial<CopyJob> = {}): CopyJob {
  return {
    op: "publish",
    channel: "mastodon",
    idempotency_key: "0123456789abcdef0123456789abcdef",
    post: { url: "https://notes.example.org/notes/a/", source_path: "notes/a.md", title: "", lang: "en", date: "2026-11-06T14:32:00Z" },
    form: "short",
    parts: [{ text: "Autumn's first hotpot https://example.org", links: ["https://example.org"] }],
    config: { server: "https://example.social/" },
    ...over,
  };
}

const thread = [{ text: "One.", links: [] }, { text: "Two.", links: [] }, { text: "Three.", links: [] }];

beforeEach(() => vi.unstubAllGlobals());

describe("publish_copy", () => {
  it("posts the text publicly, in the post's language, with the job's key, and returns the copy's address", async () => {
    const server = fakeServer();
    const r = await publish_copy(job());
    expect(r).toEqual({ success: true, copy: { id: "1", url: "https://example.social/@alex/1", parts: [] } });
    const s = server.statuses.get("1");
    expect(s.language).toBe("en");
    expect(s.key).toBe("0123456789abcdef0123456789abcdef-0");
  });

  it("posts a thread as replies, each to the part before it", async () => {
    const server = fakeServer();
    const r = await publish_copy(job({ form: "thread", parts: thread }));
    expect([...server.statuses.values()].map((s) => s.in_reply_to_id)).toEqual([null, "1", "2"]);
    expect(r.copy?.parts).toEqual([{ id: "2", url: "https://example.social/@alex/2" }, { id: "3", url: "https://example.social/@alex/3" }]);
  });

  it("takes a thread refused part way down again, so the next run sends it whole", async () => {
    const server = fakeServer({ failAt: 2 });
    const r = await publish_copy(job({ form: "thread", parts: thread }));
    expect(r.copy?.refused?.cause).toBe("content");
    expect(server.statuses.size).toBe(0);
  });

  it("says a missing token is a sign-in problem", async () => {
    fakeServer({ token: "other" });
    const r = await publish_copy(job());
    expect(r.success).toBe(false);
    expect(r.copy?.refused?.cause).toBe("auth");
  });

  it("throws when the server fails without saying why, since a status may exist", async () => {
    const server = fakeServer({ failAt: 1, status: 502 });
    await expect(publish_copy(job({ form: "thread", parts: thread }))).rejects.toThrow();
    expect(server.statuses.size).toBe(1);
  });
});

describe("find_copy", () => {
  it("finds the copy by its text among the account's statuses", async () => {
    fakeServer();
    await publish_copy(job({ parts: [{ text: "Fish & chips\n\nby the sea", links: [] }] }));
    const found = await find_copy(job({ op: "find", parts: [{ text: "Fish & chips\n\nby the sea", links: [] }] }));
    expect(found).toEqual({ success: true, copy: { id: "1", url: "https://example.social/@alex/1", parts: [] } });
  });

  it("finds every status of a thread, so a later delete removes them all", async () => {
    fakeServer();
    const posted = await publish_copy(job({ form: "thread", parts: thread }));
    expect(await find_copy(job({ op: "find", form: "thread", parts: thread }))).toEqual(posted);
  });

  it("finds a teaser by its link to the post though its words changed", async () => {
    fakeServer();
    const teaser = (text: string) => job({ op: "find", form: "teaser", parts: [{ text: `${text} https://notes.example.org/notes/a/`, links: ["https://notes.example.org/notes/a/"] }] });
    const posted = await publish_copy(teaser("On autumn."));
    expect((await find_copy(teaser("On autumn, revised."))).copy).toEqual(posted.copy);
  });

  // moss posts again on "none"; a status may exist that the lookup cannot recognise.
  it("cannot tell when no status matches, as when the text was edited after the send", async () => {
    fakeServer();
    expect((await find_copy(job({ op: "find" }))).success).toBe(false);
    await publish_copy(job());
    const edited = await find_copy(job({ op: "find", parts: [{ text: "Autumn's first hotpot, and a second bowl https://example.org", links: [] }] }));
    expect(edited.success).toBe(false);
    expect(edited.message).toMatch(/retry-copies/);
  });

  it("cannot tell when the copy has more replies than the post has parts, as when it was shortened after the send", async () => {
    fakeServer();
    await publish_copy(job({ form: "thread", parts: thread }));
    expect((await find_copy(job({ op: "find", form: "short", parts: thread.slice(0, 1) }))).success).toBe(false);
    expect((await find_copy(job({ op: "find", form: "thread", parts: thread.slice(0, 2) }))).success).toBe(false);
  });

  it("cannot tell when two statuses match, or a thread is only partly there", async () => {
    const server = fakeServer();
    await publish_copy(job());
    await publish_copy(job());
    expect((await find_copy(job({ op: "find" }))).success).toBe(false);
    server.statuses.clear();
    await publish_copy(job({ form: "thread", parts: thread.slice(0, 2) }));
    expect((await find_copy(job({ op: "find", form: "thread", parts: thread }))).success).toBe(false);
    expect(server.statuses.size).toBe(2);
  });
});

describe("update_copy", () => {
  it("edits each status in place and keeps the copy's address", async () => {
    const server = fakeServer();
    const posted = (await publish_copy(job({ form: "thread", parts: thread }))).copy!;
    const edited = [{ text: "One, edited.", links: [] }, ...thread.slice(1)];
    const r = await update_copy(job({ op: "update", parts: edited, previous: { id: posted.id!, url: posted.url!, parts: posted.parts! } }));
    expect(r.copy?.id).toBe("1");
    expect(server.statuses.get("1").content).toBe("<p>One, edited.</p>");
    expect(server.calls.filter((c) => c.startsWith("PUT"))).toHaveLength(3);
  });

  it("refuses a thread whose number of parts changed", async () => {
    fakeServer();
    const r = await update_copy(job({ op: "update", parts: thread, previous: { id: "1", url: "u", parts: [] } }));
    expect(r.copy?.refused?.message).toMatch(/3 parts and its copy 1/);
  });

  it("edits a one-status copy whose record lists no parts", async () => {
    const server = fakeServer();
    const posted = (await publish_copy(job())).copy!;
    const r = await update_copy(job({ op: "update", parts: [{ text: "Edited.", links: [] }], previous: { id: posted.id!, url: posted.url! } }));
    expect(r.copy).toEqual({ id: posted.id, url: posted.url, parts: [] });
    expect(server.statuses.get(posted.id!).content).toBe("<p>Edited.</p>");
  });
});

describe("delete_copy", () => {
  it("removes every status of the copy, last part first, and takes one already gone as removed", async () => {
    const server = fakeServer();
    const posted = (await publish_copy(job({ form: "thread", parts: thread }))).copy!;
    server.statuses.delete("3");
    const r = await delete_copy(job({ op: "delete", previous: { id: posted.id!, url: posted.url!, parts: posted.parts! } }));
    expect(r.success).toBe(true);
    expect(server.statuses.size).toBe(0);
    expect(server.calls.filter((c) => c.startsWith("DELETE"))).toEqual(["DELETE /api/v1/statuses/3", "DELETE /api/v1/statuses/2", "DELETE /api/v1/statuses/1"]);
  });

  it("removes a copy whose record lists no parts", async () => {
    const server = fakeServer();
    const posted = (await publish_copy(job())).copy!;
    expect((await delete_copy(job({ op: "delete", previous: { id: posted.id!, url: posted.url! } }))).success).toBe(true);
    expect(server.statuses.size).toBe(0);
  });
});

describe("plainText", () => {
  it("reads a status's HTML back as the text that was posted", () => {
    expect(plainText('<p>A &amp; B</p><p>see <a href="https://x.org/a/long/path" rel="nofollow">x.org/a/long/…</a><br>end</p>')).toBe("A & B\n\nsee https://x.org/a/long/path\nend");
    expect(plainText('<p><a href="https://s.example/tags/autumn" class="hashtag">#<span>autumn</span></a></p>')).toBe("#autumn");
  });
});
