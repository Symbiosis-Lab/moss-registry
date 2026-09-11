import { describe, it, expect } from "vitest";
import {
  base64ToBytesJs,
  bytesToBase64Js,
  utf8Decode,
  utf8Encode,
  relativePrefixFor,
  rewriteHtmlAbsoluteUrls,
  makeSiteRelative,
} from "../relative-urls";

describe("pure-JS codecs (QuickJS-safe)", () => {
  it("round-trips UTF-8 including CJK and emoji", () => {
    const s = "héllo 世界 🚀 plain";
    expect(utf8Decode(utf8Encode(s))).toBe(s);
  });

  it("round-trips base64 against the platform implementation", () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7 + 3) % 256);
    const b64 = bytesToBase64Js(bytes);
    expect(b64).toBe(Buffer.from(bytes).toString("base64"));
    expect(Array.from(base64ToBytesJs(b64))).toEqual(Array.from(bytes));
  });
});

describe("relativePrefixFor", () => {
  it.each([
    ["index.html", "./"],
    ["about/index.html", "../"],
    ["posts/first-post/index.html", "../../"],
  ])("%s → %s", (path, prefix) => {
    expect(relativePrefixFor(path)).toBe(prefix);
  });
});

describe("rewriteHtmlAbsoluteUrls", () => {
  it("rewrites href/src with leading slash", () => {
    const html = '<a href="/about/">x</a><script src="/_moss/js/a.js"></script>';
    expect(rewriteHtmlAbsoluteUrls(html, "../")).toBe(
      '<a href="../about/">x</a><script src="../_moss/js/a.js"></script>',
    );
  });

  it("rewrites the bare site-root link", () => {
    expect(rewriteHtmlAbsoluteUrls('<a href="/">home</a>', "../../")).toBe(
      '<a href="../../">home</a>',
    );
  });

  it("leaves protocol-relative, absolute, fragment, and mailto URLs alone", () => {
    const html =
      '<a href="//cdn.example/x"></a><a href="https://a.b/"></a>' +
      '<a href="#top"></a><a href="mailto:x@y.z"></a>';
    expect(rewriteHtmlAbsoluteUrls(html, "../")).toBe(html);
  });

  it("leaves content= meta values alone (social scrapers need absolute URLs)", () => {
    const html = '<meta property="og:image" content="/_moss/og/x.png">';
    expect(rewriteHtmlAbsoluteUrls(html, "../")).toBe(html);
  });

  it("rewrites each candidate inside srcset", () => {
    const html = '<img srcset="/a.png 1x, /b.png 2x, https://c/d.png 3x">';
    expect(rewriteHtmlAbsoluteUrls(html, "../")).toBe(
      '<img srcset="../a.png 1x, ../b.png 2x, https://c/d.png 3x">',
    );
  });
});

describe("makeSiteRelative", () => {
  const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");

  it("rewrites only HTML files, by their own depth, and recomputes sizes", () => {
    const { files, rewritten } = makeSiteRelative([
      { path: "index.html", base64: b64('<a href="/about/">'), size: 18 },
      { path: "posts/p/index.html", base64: b64('<link href="/s.css">'), size: 20 },
      { path: "assets/app.css", base64: b64("body{}"), size: 6 },
    ]);
    expect(rewritten).toBe(2);
    expect(Buffer.from(files[0].base64, "base64").toString()).toBe('<a href="./about/">');
    expect(Buffer.from(files[1].base64, "base64").toString()).toBe('<link href="../../s.css">');
    expect(Buffer.from(files[2].base64, "base64").toString()).toBe("body{}");
    expect(files[0].size).toBe(Buffer.from(files[0].base64, "base64").length);
  });

  it("passes through files with nothing to rewrite", () => {
    const input = [{ path: "index.html", base64: b64('<a href="./x">'), size: 14 }];
    const { files, rewritten } = makeSiteRelative(input);
    expect(rewritten).toBe(0);
    expect(files[0]).toBe(input[0]);
  });
});
