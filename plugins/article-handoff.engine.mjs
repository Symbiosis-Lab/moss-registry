// The hand-off page in real engines: what the button puts on the clipboard,
// and that the article's own markup runs nothing in the page that can call moss.
//
//   PLAYWRIGHT_FROM=<a package.json whose node_modules has playwright> \
//     node plugins/article-handoff.engine.mjs
//
// Run it from a plugin folder's sibling, after `npm install` in plugins/substack
// (it borrows that folder's esbuild). Not run by CI, which installs no browsers.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const { buildSync } = createRequire(join(here, "substack/package.json"))("esbuild");
const out = buildSync({ entryPoints: [join(here, "article-handoff.ts")], bundle: true, format: "esm", write: false }).outputFiles[0].text;
const { handoffPage, COPIED } = await import(`data:text/javascript;base64,${Buffer.from(out).toString("base64")}`);
const { webkit, chromium } = createRequire(process.env.PLAYWRIGHT_FROM)("playwright");

const article = {
  title: "On rivers",
  html: `<h1>On rivers</h1><h2>Source</h2><p>A <a href="https://example.org/p/">link</a> and <strong>bold</strong>.</p>` +
    `<img src="https://example.org/pic.png" alt="pic"><img src="x:" onerror="parent.hit=1;window.hit=1"><script>window.hit = 1; parent.hit = 1;</script><meta http-equiv="refresh" content="0;url=https://elsewhere.test/"><base href="https://elsewhere.test/">`,
};

for (const [name, engine] of [["webkit", webkit], ["chromium", chromium]]) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => { window.emitted = []; window.mossApi = { emit: (n) => window.emitted.push(n), close: () => { window.hit = 1; } }; });
    // A served page, as in the app; setContent would skip the init script's timing.
    await page.route("https://handoff.test/", (r) => r.fulfill({ contentType: "text/html", body: handoffPage(article, { name: "Substack", url: "https://example.substack.com/publish/post" }) }));
    await page.goto("https://handoff.test/");
    await page.waitForTimeout(300);
    await page.screenshot({ path: process.env.SHOT_DIR ? join(process.env.SHOT_DIR, `handoff-${name}.png`) : undefined });
    await page.click("#copy");
    assert.deepEqual(await page.evaluate(() => window.emitted), [COPIED], `${name}: the copy is announced once`);
    assert.equal(await page.evaluate(() => window.hit), undefined, `${name}: the article's script and onerror ran nothing`);
    await page.evaluate(() => {
      const box = document.createElement("div");
      box.contentEditable = "true";
      document.body.append(box);
      box.addEventListener("paste", (e) => { window.pasted = { html: e.clipboardData.getData("text/html"), text: e.clipboardData.getData("text/plain") }; e.preventDefault(); });
      box.focus();
    });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
    await page.waitForFunction(() => window.pasted, null, { timeout: 5000 });
    const pasted = await page.evaluate(() => window.pasted);
    assert.match(pasted.html, /<h2>Source<\/h2>/, `${name}: headings`);
    assert.match(pasted.html, /href="https:\/\/example\.org\/p\/"/, `${name}: links`);
    assert.match(pasted.html, /src="https:\/\/example\.org\/pic\.png"/, `${name}: pictures by address`);
    assert.doesNotMatch(pasted.html, /<meta|<base/, `${name}: nothing that sends the frame elsewhere`);
    assert.doesNotMatch(pasted.html, /<h1/, `${name}: the title is left for the editor's own field`);
    assert.match(pasted.text, /^Source\n\nA link and bold\.$/, `${name}: plain text beside it, a paragraph per block`);
    // A copy the engine refuses is said on the button, and no editor opens.
    await page.evaluate(() => { document.execCommand = () => false; window.emitted = []; });
    await page.click("#copy");
    assert.deepEqual(await page.evaluate(() => window.emitted), [], `${name}: a failed copy is not announced`);
    assert.equal(await page.textContent("#copy"), "Could not copy", `${name}: a failed copy is said`);
    console.log(`${name} ok`);
  } finally {
    await browser.close();
  }
}
