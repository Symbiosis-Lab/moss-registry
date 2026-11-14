import { describe, expect, it } from "vitest";
import { COPIED, handOffArticle, handoffPage, type PanelApi } from "../../../article-handoff";

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
    };
    return { api, log, on, close: () => close() };
  }

  it("opens the editor only after the copy, and ends when the panel closes", async () => {
    const f = fake();
    let done = false;
    const run = handOffArticle(f.api, { title: "T", html: "<p>x</p>" }, editor).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 5));
    expect(f.log).toEqual(["page"]);
    f.on[COPIED]();
    await new Promise((r) => setTimeout(r, 5));
    expect(f.log).toEqual(["page", `open ${editor.url}`]);
    expect(done).toBe(false);
    f.close();
    await run;
    expect(f.log.slice(2).sort()).toEqual([`stop ${COPIED}`, "stop browser-closed"]);
  });

  it("ends without opening the editor when the panel closes first", async () => {
    const f = fake();
    const run = handOffArticle(f.api, { title: "T", html: "<p>x</p>" }, editor);
    await new Promise((r) => setTimeout(r, 5));
    f.on["browser-closed"]();
    await run;
    expect(f.log.filter((l) => l.startsWith("open"))).toEqual([]);
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
    expect(f.log).toEqual(["page", `open ${editor.url}`]);
    f.close();
    await run;
  });

  it("stops listening when it cannot start", async () => {
    const f = fake();
    const on = f.api.onEvent;
    f.api.onEvent = async (name, handler) => { if (name === "browser-closed") throw new Error("no events"); return on(name, handler); };
    await expect(handOffArticle(f.api, { title: "T", html: "" }, editor)).rejects.toThrow("no events");
    expect(f.log).toEqual([`stop ${COPIED}`]);
  });
});
