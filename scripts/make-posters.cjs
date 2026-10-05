// Screenshot a built site's home page at 1600x1000, light and dark.
// Called by make-posters.sh; serves <built-dir> itself, so nothing is left
// running afterwards.
//
//   node scripts/make-posters.cjs <built-dir> <out-dir>
//
// Needs Playwright with Chromium: run from a folder whose node_modules has
// it, or set NODE_PATH to one.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error("usage: node make-posters.cjs <built-dir> <out-dir>");
  process.exit(2);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon",
};

const root = path.resolve(dir);
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(p).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({
        viewport: { width: 1600, height: 1000 }, colorScheme: scheme, deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, `home-${scheme}.png`) });
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
