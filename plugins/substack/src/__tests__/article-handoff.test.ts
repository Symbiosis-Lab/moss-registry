import { describe, expect, it } from "vitest";
import { COPIED, handOffArticle, handoffPage, openAndWait, type PanelApi } from "../../../article-handoff";

const editor = { name: "Substack", url: "https://rivers.substack.com/publish/post" };

describe("handoffPage", () => {
  it("carries the article only as data: none of its markup is markup of the page", () => {
    const html = `<p>Hi</p><script>window.mossApi.close()</script><img src=x onerror="window.mossApi.close()"></script><iframe>`;
    const page = handoffPage({ title: `A "title" <b>`, html }, editor);
    expect(page.match(/<script/g)).toHaveLength(1);
    expect(page.match(/<\/script>/g)).toHaveLength(1);
    expect(page).not.toContain("<img");
    expect(page).not.toContain("<b>");
    expect(page.match(/<iframe/g)).toHaveLength(1);
    expect(page).toContain(`sandbox=""`);
    // What the page's script reads back is the article, byte for byte.
    const data = JSON.parse(/var data = (.*);\n/.exec(page)![1]);
    expect(data).toEqual({ title: `A "title" <b>`, html, event: COPIED });
    // The script is text until an engine runs it: a slip in its quoting must fail here.
    expect(() => new Function(/<script>([\s\S]*)<\/script>/.exec(page)![1])).not.toThrow();
  });
});

describe("handOffArticle", () => {
  function fake() {
    const log: string[] = [];
    const on: Record<string, () => void> = {};
    let close!: () => void;
    const api: PanelApi = {
      openBrowserWithHtml: async () => { log.push("page"); },
      openBrowser: async (url) => { log.push(`open ${url}`); return { closed: new Promise<void>((resolve) => (close = resolve)) }; },
      onEvent: async (name, handler) => { on[name] = handler as () => void; return () => { log.push(`stop ${name}`); }; },
      startTask: async () => ({ awaiting: async (directive, venue) => { log.push(`awaiting ${directive} in ${venue}`); }, succeeded: async () => { log.push("waited"); } }),
    };
    return { api, log, on, close: () => close() };
  }

  const waiting = "awaiting paste and publish the article in Substack";

  it("tells moss it waits for the author from the page to the close, and opens the editor only after the copy", async () => {
    const f = fake();
    let done = false;
    const run = handOffArticle(f.api, { title: "T", html: "<p>x</p>" }, editor).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 5));
    expect(f.log).toEqual(["page", waiting]);
    f.on[COPIED]();
    await new Promise((r) => setTimeout(r, 5));
    expect(f.log).toEqual(["page", waiting, `open ${editor.url}`]);
    expect(done).toBe(false);
    f.close();
    await run;
    expect(f.log[3]).toBe("waited");
    expect(f.log.slice(4).sort()).toEqual([`stop ${COPIED}`, "stop browser-closed"]);
  });

  it("ends without opening the editor when the panel closes first", async () => {
    const f = fake();
    const run = handOffArticle(f.api, { title: "T", html: "<p>x</p>" }, editor);
    await new Promise((r) => setTimeout(r, 5));
    f.on["browser-closed"]();
    await run;
    expect(f.log.slice(0, 3)).toEqual(["page", waiting, "waited"]);
  });

  it("takes a close heard before its page is up as the panel before it", async () => {
    const f = fake();
    const open = f.api.openBrowserWithHtml;
    f.api.openBrowserWithHtml = async (html) => { f.on["browser-closed"](); await open(html); };
    let done = false;
    const run = handOffArticle(f.api, { title: "T", html: "<p>x</p>" }, editor).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 5));
    expect(done).toBe(false);
    f.on[COPIED]();
    await new Promise((r) => setTimeout(r, 5));
    expect(f.log).toEqual(["page", waiting, `open ${editor.url}`]);
    f.close();
    await run;
  });

  it("ends the wait when the editor cannot open", async () => {
    const f = fake();
    f.api.openBrowser = async () => { throw new Error("no editor"); };
    const run = handOffArticle(f.api, { title: "T", html: "<p>x</p>" }, editor);
    await new Promise((r) => setTimeout(r, 5));
    f.on[COPIED]();
    await expect(run).rejects.toThrow("no editor");
    expect(f.log.slice(0, 3)).toEqual(["page", waiting, "waited"]);
  });

  it("stops listening when it cannot start", async () => {
    const f = fake();
    const on = f.api.onEvent;
    f.api.onEvent = async (name, handler) => { if (name === "browser-closed") throw new Error("no events"); return on(name, handler); };
    await expect(handOffArticle(f.api, { title: "T", html: "" }, editor)).rejects.toThrow("no events");
    expect(f.log).toEqual([`stop ${COPIED}`]);
  });
});

describe("openAndWait", () => {
  it("tells moss it waits for the author while the page is open, and not when there is no panel", async () => {
    const log: string[] = [];
    let close!: () => void;
    const api = {
      openBrowser: async (url: string) => { log.push(`open ${url}`); return { closed: new Promise<void>((resolve) => (close = resolve)) }; },
      startTask: async () => ({ awaiting: async (directive: string, venue: string) => { log.push(`awaiting ${directive} in ${venue}`); }, succeeded: async () => { log.push("waited"); } }),
    };
    const run = openAndWait(api, "post", "X", "https://x.test/");
    await new Promise((r) => setTimeout(r, 5));
    expect(log).toEqual(["open https://x.test/", "awaiting post in X"]);
    close();
    await run;
    expect(log[2]).toBe("waited");

    log.length = 0;
    await expect(openAndWait({ ...api, openBrowser: async () => { throw new Error("no app"); } }, "post", "X", "https://x.test/")).rejects.toThrow("no app");
    expect(log).toEqual([]);
  });
});
