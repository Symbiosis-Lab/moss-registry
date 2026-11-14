import { Window } from "happy-dom";
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

  it("copies the article's words, not its script or style", () => {
    const page = handoffPage({ title: "T", html: "<h1>T</h1><p>Words</p><p>a<script>code()</script></p><style>p { color: red }</style>" }, editor);
    const w = new Window();
    w.document.body.innerHTML = `<button id="copy"></button><iframe id="article"></iframe>`;
    const clip: Record<string, string> = {};
    (w.document as any).execCommand = () => { w.document.dispatchEvent(Object.assign(new w.Event("copy"), { clipboardData: { setData: (t: string, v: string) => (clip[t] = v) } })); return true; };
    (w as any).mossApi = { emit() {} };
    new Function("window", "document", "DOMParser", "getSelection", /<script>([\s\S]*)<\/script>/.exec(page)![1])(w, w.document, w.DOMParser, () => w.getSelection());
    w.document.getElementById("copy")!.click();
    expect(clip).toEqual({ "text/html": "<p>Words</p><p>a</p>", "text/plain": "Words\n\na" });
    expect((w.document.getElementById("article") as any).srcdoc).not.toMatch(/code\(\)|color: red/);
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
      startTask: async () => ({ awaiting: async (directive, venue) => { log.push(`awaiting ${directive} in ${venue}`); }, succeeded: async () => { log.push("waited"); }, cancelled: async () => { log.push("left"); } }),
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

  it("ends the wait as left, without opening the editor, when the panel closes first", async () => {
    const f = fake();
    const run = handOffArticle(f.api, { title: "T", html: "<p>x</p>" }, editor);
    await new Promise((r) => setTimeout(r, 5));
    f.on["browser-closed"]();
    await run;
    expect(f.log.slice(0, 3)).toEqual(["page", waiting, "left"]);
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

  it("ends the wait as left, not done, when the editor cannot open", async () => {
    const f = fake();
    f.api.openBrowser = async () => { throw new Error("no editor"); };
    const run = handOffArticle(f.api, { title: "T", html: "<p>x</p>" }, editor);
    await new Promise((r) => setTimeout(r, 5));
    f.on[COPIED]();
    await expect(run).rejects.toThrow("no editor");
    expect(f.log.slice(0, 3)).toEqual(["page", waiting, "left"]);
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
      startTask: async () => ({ awaiting: async (directive: string, venue: string) => { log.push(`awaiting ${directive} in ${venue}`); }, succeeded: async () => { log.push("waited"); }, cancelled: async () => { log.push("left"); } }),
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
