import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@symbiosis-lab/moss-api", () => ({ readSiteFile: vi.fn() }));
vi.mock("../api", () => ({ uploadAssetMultipart: vi.fn(), uploadAssetByUrl: vi.fn() }));
import { readSiteFile } from "@symbiosis-lab/moss-api";
import { uploadAssetMultipart } from "../api";
import {
  normalizeHtmlForMatters, wrapImagesForMatters, wrapAudioForMatters,
  stripHeadingAnchors, stripArticleTitleH1, absolutizeRelativeHrefs,
  uploadAndReplaceLocalAudio, siteRelativePathFromSrc, imageMimeForPath, audioMimeForPath,
} from "../content";

describe("stripArticleTitleH1", () => {
  it("strips moss-article-title h1 when text matches", () => {
    const html = '<h1 class="moss-article-title">My Title</h1><p>Body.</p>';
    expect(stripArticleTitleH1(html, "My Title")).toBe("<p>Body.</p>");
  });

  it("strips when class is one of several", () => {
    const html = '<h1 class="foo moss-article-title bar">My Title</h1><p>Body.</p>';
    expect(stripArticleTitleH1(html, "My Title")).toBe("<p>Body.</p>");
  });

  it("ignores h1 with the moss class but mismatched text (author-edited)", () => {
    const html = '<h1 class="moss-article-title">Different</h1>';
    expect(stripArticleTitleH1(html, "My Title")).toBe(html);
  });

  it("ignores plain h1 (no moss-article-title class)", () => {
    const html = '<h1>My Title</h1><p>Body.</p>';
    expect(stripArticleTitleH1(html, "My Title")).toBe(html);
  });

  it("ignores h2/h3 even when text matches and class is present", () => {
    const html = '<h2 class="moss-article-title">My Title</h2>';
    expect(stripArticleTitleH1(html, "My Title")).toBe(html);
  });

  it("tolerates inline tags inside the h1", () => {
    const html = '<h1 class="moss-article-title">My <em>fancy</em> Title</h1>';
    expect(stripArticleTitleH1(html, "My fancy Title")).toBe("");
  });

  it("collapses whitespace before comparing", () => {
    const html = '<h1 class="moss-article-title">  My\n  Title  </h1>';
    expect(stripArticleTitleH1(html, "My Title")).toBe("");
  });

  it("does not affect non-leading h1s on its own (multiple h1s case)", () => {
    // The strip is class-gated, so a body-internal plain <h1> survives.
    const html = '<h1 class="moss-article-title">My Title</h1><p>x</p><h1>Also Title</h1>';
    expect(stripArticleTitleH1(html, "My Title")).toBe('<p>x</p><h1>Also Title</h1>');
  });
});

// ============================================================================
// Tests: absolutizeRelativeHrefs
// ============================================================================


describe("absolutizeRelativeHrefs", () => {
  const baseUrl = "https://example.com/posts/foo/";

  it("resolves a deep-relative href against the article URL", () => {
    const html = '<a href="../../scale-compare.html">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(
      '<a href="https://example.com/scale-compare.html">link</a>',
    );
  });

  it("resolves a sibling-relative href", () => {
    const html = '<a href="other.html">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(
      '<a href="https://example.com/posts/foo/other.html">link</a>',
    );
  });

  it("resolves a root-relative href against the site origin", () => {
    const html = '<a href="/about/">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(
      '<a href="https://example.com/about/">link</a>',
    );
  });

  it("leaves http URLs untouched", () => {
    const html = '<a href="https://other.com/x">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("leaves mailto: untouched", () => {
    const html = '<a href="mailto:a@b.com">email</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("leaves fragment-only links untouched (intra-document)", () => {
    const html = '<a href="#section">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("leaves protocol-relative URLs untouched", () => {
    const html = '<a href="//cdn.example.com/x.js">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("preserves attributes around the href", () => {
    const html = '<a class="x" href="../foo.html" target="_blank" rel="noopener">link</a>';
    const result = absolutizeRelativeHrefs(html, baseUrl);
    expect(result).toContain('class="x"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener"');
    expect(result).toContain('href="https://example.com/posts/foo.html"');
  });

  it("handles multiple anchors in one document", () => {
    const html = '<a href="a.html">a</a><p>x</p><a href="../b.html">b</a>';
    const result = absolutizeRelativeHrefs(html, baseUrl);
    expect(result).toContain('href="https://example.com/posts/foo/a.html"');
    expect(result).toContain('href="https://example.com/posts/b.html"');
  });

  it("does not touch <img src> attributes", () => {
    const html = '<img src="../foo.gif">';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("preserves &amp;-encoded query strings in resolved hrefs", () => {
    // moss-generated HTML uses HTML entities for & in attributes. Make sure
    // the regex captures and re-emits them unchanged so the resulting href
    // is still well-formed HTML.
    const html = '<a href="../foo?a=1&amp;b=2">link</a>';
    const result = absolutizeRelativeHrefs(html, baseUrl);
    expect(result).toContain('href="https://example.com/posts/foo?a=1&amp;b=2"');
  });

  it("leaves empty href untouched", () => {
    // The regex requires at least one character inside the quotes, so empty
    // hrefs fall through unchanged. That's the safer default — rewriting
    // empty hrefs to the article URL would silently turn a broken link into
    // a self-link, which is worse than leaving it broken.
    const html = '<a href="">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });
});

// ============================================================================
// Tests: normalizeHtmlForMatters — heading transformation
// ============================================================================


describe("normalizeHtmlForMatters - heading transformation", () => {
  it("downgrades h1 to h2", () => {
    const html = "<h1>Title</h1><p>Content</p>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h2>Title</h2><p>Content</p>");
  });

  it("keeps h2 as h2", () => {
    const html = "<h2>Subtitle</h2>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h2>Subtitle</h2>");
  });

  it("keeps h3 as h3", () => {
    const html = "<h3>Section</h3>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h3>Section</h3>");
  });

  it("collapses h4 to h3", () => {
    const html = "<h4>Sub-section</h4>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h3>Sub-section</h3>");
  });

  it("collapses h5 to h3", () => {
    const html = "<h5>Deep</h5>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h3>Deep</h3>");
  });

  it("collapses h6 to h3", () => {
    const html = "<h6>Deepest</h6>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h3>Deepest</h3>");
  });

  it("handles h1 with attributes", () => {
    const html = '<h1 id="top" class="title">Title</h1>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe('<h2 id="top" class="title">Title</h2>');
  });

  it("handles h4 with attributes", () => {
    const html = '<h4 id="sub">Sub</h4>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe('<h3 id="sub">Sub</h3>');
  });

  it("processes multiple heading levels in the same document", () => {
    const html = "<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h2>H1</h2><h2>H2</h2><h3>H3</h3><h3>H4</h3><h3>H5</h3><h3>H6</h3>");
  });

  it("does not double-shift h4-h6 (processes h4-h6 before h1)", () => {
    // If h1→h2 ran first, then h4→h3 would still be fine,
    // but we want to ensure the order is correct:
    // h4-h6→h3 first, then h1→h2
    const html = "<h1>Title</h1><h4>Detail</h4>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h2>Title</h2><h3>Detail</h3>");
  });

  it("handles content with no headings", () => {
    const html = "<p>Just a paragraph</p>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<p>Just a paragraph</p>");
  });
});

// ============================================================================
// Tests: wrapImagesForMatters
// ============================================================================
//
// matters' server-side sanitizer requires images to be wrapped in
// `<figure class="image"><img src="..."><figcaption>...</figcaption></figure>`.
// Anything else (`<figure class="moss-image">`, `<picture>` standalone, bare
// `<img>`) gets stripped on draft storage. Empirically verified 2026-05-27
// via smoke test against `server.matters.icu`.
//
// `wrapImagesForMatters` is matters-specific — moss's emission stays as-is
// for the web; this transform only applies on the syndication path.


describe("wrapImagesForMatters", () => {
  it("wraps a bare img inside a <p> in figure.image", () => {
    const html = '<p><img src="photo.jpg" alt="Photo"></p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg" alt="Photo"><figcaption></figcaption></figure>',
    );
  });

  it("wraps a self-closing img alone in <p>", () => {
    const html = '<p><img src="photo.jpg" /></p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg" /><figcaption></figcaption></figure>',
    );
  });

  it("renames figure.moss-image → figure.image and adds empty figcaption when missing", () => {
    const html = '<figure class="moss-image"><img src="photo.jpg"></figure>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg"><figcaption></figcaption></figure>',
    );
  });

  it("renames figure.moss-image → figure.image and preserves existing figcaption", () => {
    const html =
      '<figure class="moss-image"><img src="photo.jpg"><figcaption>A caption</figcaption></figure>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg"><figcaption>A caption</figcaption></figure>',
    );
  });

  it("wraps standalone <picture> (variant pattern from moss raster output) in figure.image", () => {
    const html =
      '<picture><source srcset="photo.webp" type="image/webp"><img src="photo.jpg"></picture>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><picture><source srcset="photo.webp" type="image/webp"><img src="photo.jpg"></picture><figcaption></figcaption></figure>',
    );
  });

  it("hoists <p><picture></p> out of the <p> (figure-in-p is invalid HTML)", () => {
    const html =
      '<p><picture><source srcset="photo.webp"><img src="photo.jpg"></picture></p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><picture><source srcset="photo.webp"><img src="photo.jpg"></picture><figcaption></figcaption></figure>',
    );
  });

  it("does not double-wrap <picture> that's already inside figure.image", () => {
    const html =
      '<figure class="moss-image"><picture><source srcset="photo.webp"><img src="photo.jpg"></picture><figcaption>Cap</figcaption></figure>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><picture><source srcset="photo.webp"><img src="photo.jpg"></picture><figcaption>Cap</figcaption></figure>',
    );
  });

  it("wraps multiple standalone images independently", () => {
    const html = '<p><img src="a.jpg"></p><p>text</p><p><img src="b.jpg"></p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="a.jpg"><figcaption></figcaption></figure>' +
        "<p>text</p>" +
        '<figure class="image"><img src="b.jpg"><figcaption></figcaption></figure>',
    );
  });

  it("leaves figure.image untouched (already in matters shape)", () => {
    const html =
      '<figure class="image"><img src="photo.jpg"><figcaption>cap</figcaption></figure>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg"><figcaption>cap</figcaption></figure>',
    );
  });

  it("wraps bare <img> between block elements", () => {
    const html = '<p>Before</p><img src="photo.jpg"><p>After</p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<p>Before</p><figure class="image"><img src="photo.jpg"><figcaption></figcaption></figure><p>After</p>',
    );
  });
});

// ============================================================================
// Tests: stripHeadingAnchors
// ============================================================================
//
// moss appends a permalink anchor to every heading:
//   <h2 id="1.">1.<a class="moss-heading-anchor" href="#1." aria-label="…"></a></h2>
// The `#` a reader sees is drawn by CSS (`::after`), so the anchor is empty —
// but it is still web-only chrome, and an empty link is not content either, so
// we strip the whole anchor on syndication.
//
// It used to hold a real `<span aria-hidden="true">#</span>`, which matters'
// sanitizer kept, so headings syndicated as "1.#" — a stray, linked `#`.
// Verified 2026-06-16 against server.matters.icu. That shape is still in every
// already-published article and in output from an older moss, so the stripper
// must keep handling both; one test below pins the legacy form.


describe("stripHeadingAnchors", () => {
  it("removes the moss-heading-anchor permalink from a heading", () => {
    const html =
      '<h1 id="1." data-source-line="8">1.<a class="moss-heading-anchor" href="#1." aria-label="Permalink to this section"></a></h1>';
    expect(stripHeadingAnchors(html)).toBe('<h1 id="1." data-source-line="8">1.</h1>');
  });

  it("strips anchors from multiple headings, leaving heading text intact", () => {
    const html =
      '<h2>Intro<a class="moss-heading-anchor" href="#intro"></a></h2>' +
      "<p>body</p>" +
      '<h3>详情<a class="moss-heading-anchor" href="#详情"></a></h3>';
    expect(stripHeadingAnchors(html)).toBe("<h2>Intro</h2><p>body</p><h3>详情</h3>");
  });

  // The pre-2026-08-09 shape, when the `#` was a real text node. Still arrives
  // from an older moss and from anything already published, and it is the one
  // that syndicates visibly wrong if the stripper stops matching it.
  it("still strips the legacy anchor that carried a literal #", () => {
    const html =
      '<h2>Intro<a class="moss-heading-anchor" href="#intro"><span aria-hidden="true">#</span></a></h2>';
    expect(stripHeadingAnchors(html)).toBe("<h2>Intro</h2>");
  });

  it("tolerates attribute order and extra classes on the anchor", () => {
    const html = '<h2>T<a href="#t" class="foo moss-heading-anchor bar"><span>#</span></a></h2>';
    expect(stripHeadingAnchors(html)).toBe("<h2>T</h2>");
  });

  it("leaves ordinary anchors (non-heading-anchor) untouched", () => {
    const html = '<h2>See <a href="/other">link</a></h2>';
    expect(stripHeadingAnchors(html)).toBe(html);
  });

  it("leaves content without heading anchors unchanged", () => {
    const html = "<h2>Title</h2><p>text</p>";
    expect(stripHeadingAnchors(html)).toBe(html);
  });
});

// Also exercised via the full normalizeHtmlForMatters pipeline.

describe("normalizeHtmlForMatters - strips heading anchors", () => {
  it("removes the permalink # and downgrades h1→h2 in one pass", () => {
    const html =
      '<h1 id="1.">1.<a class="moss-heading-anchor" href="#1."></a></h1>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe('<h2 id="1.">1.</h2>');
    expect(result).not.toContain("#");
    expect(result).not.toContain("moss-heading-anchor");
  });
});

// ============================================================================
// Tests: wrapAudioForMatters
// ============================================================================
//
// moss emits audio as a bare `<audio class="moss-embed moss-embed-audio"
// controls preload="metadata"><source src="..." type="..."></audio>`. matters'
// server-side sanitizer STRIPS that shape entirely (the whole <audio> vanishes;
// only the fallback text leaks out as a stray <p>). Empirically verified
// 2026-06-16 against `server.matters.icu`: the only audio shape matters keeps is
//   <figure class="audio"><audio controls><source src="URL" type="MIME"></audio>
//   <figcaption>…</figcaption></figure>
// where (a) the URL MUST live on a <source> child (a `src` on <audio> itself is
// dropped), (b) a <figcaption> child is REQUIRED — its absence triggers a server
// error ("Cannot read properties of undefined (reading 'firstChild')"), empty is
// fine, and (c) matters keeps an EXTERNAL <source src> verbatim, so the audio can
// stream straight from the deployed site — no upload to matters is needed (and
// matters' `embedaudio` asset type rejects url-upload anyway).
//
// So this transform restructures moss's audio into matters' figure shape and
// absolutizes the <source src> against the article URL (same rule as
// absolutizeRelativeHrefs), so matters' player streams from the live site.

/**
 * Every `html` literal below is REAL `moss build` output, captured 2026-07-21
 * from a vault built with `moss build <site> --no-plugins`. Attribute order
 * (`class` then `data-moss-math`) and the HTML-escaping of the TeX are
 * verbatim, not reconstructed.
 */

describe("wrapAudioForMatters", () => {
  const base = "https://example.com/posts/test/";

  it("wraps moss audio into figure.audio and absolutizes a relative src", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3" type="audio/mpeg">Your browser does not support the audio tag.</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/test/song.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>',
    );
  });

  it("resolves deep-relative srcs against the article URL", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="../assets/song.mp3" type="audio/mpeg">fallback</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/assets/song.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>',
    );
  });

  it("leaves an already-absolute src unchanged", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="https://cdn.example.com/a.mp3" type="audio/mpeg">x</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://cdn.example.com/a.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>',
    );
  });

  it("hoists audio out of a wrapping <p> (figure-in-p is invalid HTML)", () => {
    const html =
      '<p><audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3" type="audio/mpeg">x</audio></p>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/test/song.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>',
    );
  });

  it("drops the <audio> fallback text (no leak into figcaption or siblings)", () => {
    const html =
      '<p>Before</p><audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3" type="audio/mpeg">Your browser does not support the audio tag.</audio><p>After</p>';
    const result = wrapAudioForMatters(html, base);
    expect(result).not.toContain("does not support");
    expect(result).toBe(
      '<p>Before</p><figure class="audio"><audio controls><source src="https://example.com/posts/test/song.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure><p>After</p>',
    );
  });

  it("omits the type attr when moss emitted none", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3">x</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/test/song.mp3"></audio><figcaption></figcaption></figure>',
    );
  });

  it("wraps multiple audio embeds independently", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="a.mp3" type="audio/mpeg">x</audio>' +
      "<p>mid</p>" +
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="b.wav" type="audio/wav">y</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/test/a.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>' +
        "<p>mid</p>" +
        '<figure class="audio"><audio controls><source src="https://example.com/posts/test/b.wav" type="audio/wav"></audio><figcaption></figcaption></figure>',
    );
  });

  it("leaves content without audio untouched", () => {
    const html = "<h2>Title</h2><p>No audio here</p>";
    expect(wrapAudioForMatters(html, base)).toBe(html);
  });
});

// Also called via normalizeHtmlForMatters (the full pipeline)

describe("normalizeHtmlForMatters - image wrap (via pipeline)", () => {
  it("wraps a standalone img while leaving headings alone", () => {
    const html = '<h2>Title</h2><p><img src="photo.jpg"></p>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toContain('<figure class="image"><img src="photo.jpg"><figcaption></figcaption></figure>');
    expect(result).toContain("<h2>Title</h2>");
  });

  it("downgrades h1 and wraps img in the same pass", () => {
    const html = '<h1>Title</h1><p><img src="photo.jpg"></p>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toContain("<h2>Title</h2>");
    expect(result).toContain('<figure class="image"><img src="photo.jpg"><figcaption></figcaption></figure>');
  });
});

// ============================================================================
// Image paths and MIME types
// ============================================================================


describe("siteRelativePathFromSrc", () => {
  const base = "https://liu-guo.com/posts/foo/";

  it("resolves a site-absolute src to a relative site path", () => {
    expect(siteRelativePathFromSrc("/image/x.jpg", "https://liu-guo.com/posts/foo/"))
      .toBe("image/x.jpg");
  });

  it("resolves a same-directory relative src", () => {
    expect(siteRelativePathFromSrc("photo.jpg", base)).toBe("posts/foo/photo.jpg");
  });

  it("resolves a parent-traversal relative src", () => {
    expect(siteRelativePathFromSrc("../a.jpg", "https://s.com/p/q/")).toBe("p/a.jpg");
  });

  it("resolves a deep-relative src (../../) against the article URL", () => {
    expect(siteRelativePathFromSrc("../../assets/x.gif", "https://example.com/writings/foo-bar/"))
      .toBe("assets/x.gif");
  });

  it("returns null for a data: URI", () => {
    expect(siteRelativePathFromSrc("data:image/png;base64,abc=", base)).toBeNull();
  });

  it("returns null for a cross-origin absolute URL", () => {
    expect(siteRelativePathFromSrc("https://other.com/x.jpg", base)).toBeNull();
  });

  it("returns null for a matters CDN URL (different origin)", () => {
    expect(siteRelativePathFromSrc("https://assets.matters.news/embed/abc.jpg", base)).toBeNull();
  });

  it("decodes percent-encoded pathname characters", () => {
    expect(siteRelativePathFromSrc("/%E5%9B%BE%E7%89%87/photo.png", "https://example.com/"))
      .toBe("图片/photo.png");
  });

  it("resolves same-origin absolute URL to its site path", () => {
    expect(siteRelativePathFromSrc("https://liu-guo.com/image/x.jpg", "https://liu-guo.com/posts/foo/"))
      .toBe("image/x.jpg");
  });
});

// ============================================================================
// Tests: imageMimeForPath
// ============================================================================


describe("imageMimeForPath", () => {
  it("maps .jpg to image/jpeg", () => {
    expect(imageMimeForPath("photo.jpg")).toBe("image/jpeg");
  });

  it("maps .jpeg to image/jpeg", () => {
    expect(imageMimeForPath("photo.jpeg")).toBe("image/jpeg");
  });

  it("maps .png to image/png", () => {
    expect(imageMimeForPath("cover.png")).toBe("image/png");
  });

  it("maps .webp to image/webp", () => {
    expect(imageMimeForPath("img.webp")).toBe("image/webp");
  });

  it("maps .gif to image/gif", () => {
    expect(imageMimeForPath("anim.gif")).toBe("image/gif");
  });

  it("maps .avif to image/avif", () => {
    expect(imageMimeForPath("photo.avif")).toBe("image/avif");
  });

  it("maps .svg to image/svg+xml", () => {
    expect(imageMimeForPath("icon.svg")).toBe("image/svg+xml");
  });

  it("returns application/octet-stream for unknown extensions", () => {
    expect(imageMimeForPath("file.bmp")).toBe("application/octet-stream");
  });
});

// ============================================================================
// Tests: audioMimeForPath
// ============================================================================


describe("audioMimeForPath", () => {
  it("maps .mp3 to audio/mpeg", () => {
    expect(audioMimeForPath("song.mp3")).toBe("audio/mpeg");
  });

  it("maps .wav to audio/wav", () => {
    expect(audioMimeForPath("sound.wav")).toBe("audio/wav");
  });

  it("maps .ogg to audio/ogg", () => {
    expect(audioMimeForPath("track.ogg")).toBe("audio/ogg");
  });

  it("maps .flac to audio/flac", () => {
    expect(audioMimeForPath("lossless.flac")).toBe("audio/flac");
  });

  it("maps .m4a to audio/mp4", () => {
    expect(audioMimeForPath("podcast.m4a")).toBe("audio/mp4");
  });

  it("maps .opus to audio/opus", () => {
    expect(audioMimeForPath("voice.opus")).toBe("audio/opus");
  });

  it("returns application/octet-stream for unknown extensions", () => {
    expect(audioMimeForPath("file.aiff")).toBe("application/octet-stream");
  });
});

// ============================================================================
// Tests: uploadAndReplaceLocalAudio
// ============================================================================


describe("uploadAndReplaceLocalAudio", () => {
  // After wrapAudioForMatters, the <source src> is already an absolutized
  // deployed URL (e.g. "https://liu-guo.com/posts/foo/song.mp3"). The audio
  // upload step tries to read it from the local build and replace it with a
  // durable matters CDN URL; on failure the absolutized deployed URL stays.
  const baseUrl = "https://liu-guo.com/posts/foo/";
  const entityId = "draft-audio-test";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({
      id: "audio-asset-id",
      path: "https://assets.matters.news/embedaudio/uploaded.mp3",
    });
  });

  it("uploads audio bytes and replaces <source src> with CDN URL", async () => {
    const html =
      '<figure class="audio"><audio controls>' +
      '<source src="https://liu-guo.com/posts/foo/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    expect(readSiteFile).toHaveBeenCalledWith("posts/foo/song.mp3");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "song.mp3",
      "audio/mpeg",
      "embedaudio",
      entityId,
      "draft"
    );
    expect(result).toContain('src="https://assets.matters.news/embedaudio/uploaded.mp3"');
    expect(result).not.toContain('src="https://liu-guo.com/posts/foo/song.mp3"');
  });

  it("leaves <source src> unchanged on upload error (deployed URL streams fine)", async () => {
    vi.mocked(uploadAssetMultipart).mockRejectedValueOnce(new Error("Upload failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const html =
      '<figure class="audio"><audio controls>' +
      '<source src="https://liu-guo.com/posts/foo/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    // src stays unchanged — the deployed URL lets matters stream it
    expect(result).toContain('src="https://liu-guo.com/posts/foo/song.mp3"');

    vi.restoreAllMocks();
  });

  it("leaves <source src> unchanged on readSiteFile error", async () => {
    vi.mocked(readSiteFile).mockRejectedValueOnce(new Error("File not found"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const html =
      '<figure class="audio"><audio controls>' +
      '<source src="https://liu-guo.com/posts/foo/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    expect(result).toContain('src="https://liu-guo.com/posts/foo/song.mp3"');

    vi.restoreAllMocks();
  });

  it("does NOT touch <img src> attributes — only matches <source>", async () => {
    const html =
      '<figure class="image"><img src="https://liu-guo.com/posts/foo/photo.jpg"></figure>' +
      '<figure class="audio"><audio controls>' +
      '<source src="https://liu-guo.com/posts/foo/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    // img src is not changed
    expect(result).toContain('src="https://liu-guo.com/posts/foo/photo.jpg"');
    // source src is replaced
    expect(result).toContain('src="https://assets.matters.news/embedaudio/uploaded.mp3"');
    // readSiteFile only called once (for the audio, not the image)
    expect(readSiteFile).toHaveBeenCalledTimes(1);
    expect(readSiteFile).toHaveBeenCalledWith("posts/foo/song.mp3");
  });

  it("returns content unchanged when no <source> elements are present", async () => {
    const html = "<p>Just text, no audio</p>";

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(result).toBe(html);
  });

  it("leaves cross-origin <source src> unchanged (external CDN audio)", async () => {
    const html =
      '<figure class="audio"><audio controls>' +
      '<source src="https://cdn.other.com/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    // Cross-origin src → no upload, no change
    expect(readSiteFile).not.toHaveBeenCalled();
    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(result).toBe(html);
  });
});

// ============================================================================
// Tests: an article copy - local image upload integration
// ============================================================================

