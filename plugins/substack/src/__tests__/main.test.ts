import { beforeEach, describe, expect, it, vi } from "vitest";

const panel = { pages: [] as string[], on: {} as Record<string, () => void>, opened: [] as string[], waits: [] as string[] };
vi.mock("@symbiosis-lab/moss-api", () => ({
  openBrowser: vi.fn(async (url: string) => { panel.opened.push(url); return { closed: Promise.resolve() }; }),
  openBrowserWithHtml: vi.fn(async (html: string) => { panel.pages.push(html); }),
  onEvent: vi.fn(async (name: string, handler: () => void) => { panel.on[name] = handler; return () => {}; }),
  startTask: vi.fn(async () => ({ awaiting: async (directive: string, venue: string) => { panel.waits.push(`${directive} in ${venue}`); }, succeeded: async () => {} })),
}));

import { find_copy, publish_copy, type CopyJob } from "../main";

const HOME = "https://rivers.substack.com";
const PAGE = "https://example.org/writing/on-rivers/";

function job(over: Partial<CopyJob> = {}): CopyJob {
  return { op: "publish", channel: "substack", post: { url: PAGE, title: "On rivers" }, form: "long", article: { title: "On rivers", html: "<p>Long.</p>" }, config: { publication: `${HOME}/` }, ...over };
}

const item = (link: string, body: string) => `<item><title><![CDATA[On rivers]]></title><link>${link}</link><content:encoded><![CDATA[${body}]]></content:encoded></item>`;
const feed = (...items: string[]) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Rivers</title>${items.join("")}</channel></rss>`;
const serve = (status: number, body = "") => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status < 400, status, text: async () => body })));

beforeEach(() => {
  vi.unstubAllGlobals();
  Object.assign(panel, { pages: [], on: {}, opened: [], waits: [] });
});

describe("publish_copy", () => {
  it("shows the article to copy, then opens the publication's editor", async () => {
    const sent = publish_copy(job());
    await new Promise((r) => setTimeout(r, 10));
    expect(panel.pages[0]).toContain("Copy and open Substack");
    expect(panel.waits).toEqual(["paste and publish the article in Substack"]);
    expect(panel.opened).toEqual([]);
    panel.on["article-handoff:copied"]();
    expect(await sent).toEqual({ success: true, copy: { handoff: { text: "", open_url: `${HOME}/publish/post` } } });
    expect(panel.opened).toEqual([`${HOME}/publish/post`]);
  });

  it("opens no editor when the panel is closed before copying", async () => {
    const sent = publish_copy(job());
    await new Promise((r) => setTimeout(r, 10));
    panel.on["browser-closed"]();
    expect((await sent).copy?.handoff?.open_url).toBe(`${HOME}/publish/post`);
    expect(panel.opened).toEqual([]);
  });

  it("refuses without the publication's address, and says when one is not https", async () => {
    for (const publication of [undefined, "", "rivers"]) {
      expect((await publish_copy(job({ config: { publication } }))).copy?.refused).toEqual({ cause: "auth", message: "set your Substack's address first" });
    }
    expect((await publish_copy(job({ config: { publication: "http://rivers.substack.com" } }))).copy?.refused).toEqual({ cause: "auth", message: "your Substack's address must start with https://, not http://rivers.substack.com" });
    expect(panel.pages).toEqual([]);
  });

  it("refuses a job that carries no article", async () => {
    expect((await publish_copy(job({ article: null }))).copy?.refused?.cause).toBe("content");
    expect(panel.pages).toEqual([]);
  });
});

describe("find_copy", () => {
  const post = `${HOME}/p/on-rivers`;

  it("finds the post whose body links back to the page", async () => {
    serve(200, feed(item(`${HOME}/p/other`, `<p>See <a href="https://example.org/">home</a></p>`), item(post, `<p>Originally published on <a href="${PAGE.slice(0, -1)}">Example</a>.</p>`)));
    expect(await find_copy(job({ op: "find" }))).toEqual({ success: true, copy: { id: post, url: post } });
  });

  it("takes the oldest post that links back, over a later one that mentions the page", async () => {
    const link = `<p><a href="${PAGE}">the original</a></p>`;
    serve(200, feed(item(`${HOME}/p/a-year-on`, link), item(post, link)));
    expect((await find_copy(job({ op: "find" }))).copy?.url).toBe(post);
  });

  it("keeps waiting when no listed post links back", async () => {
    serve(200, feed(item(`${HOME}/p/other`, `<p>On rivers, but about ${PAGE}</p>`)));
    expect(await find_copy(job({ op: "find" }))).toEqual({ success: true, copy: { handoff: { text: "", open_url: `${HOME}/publish/post` } } });
  });

  it("says nothing is known when the feed cannot be read", async () => {
    serve(503);
    await expect(find_copy(job({ op: "find" }))).rejects.toThrow("503");
    serve(200, "<html>Sign in</html>");
    await expect(find_copy(job({ op: "find" }))).rejects.toThrow("not a feed");
  });
});
