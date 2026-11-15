import { encodeBase64, toUtf8Bytes } from "ethers";
import { readSiteFile } from "@symbiosis-lab/moss-api";
import { uploadAssetMultipart, uploadAssetByUrl, MattersRefusal } from "./api";

/** Remove the generated title only when it duplicates the separate title field. */
export function stripArticleTitleH1(html: string, articleTitle: string): string {
  // Match <h1 ...class="...moss-article-title..."...>INNER</h1>
  const re = /<h1\b[^>]*class="[^"]*\bmoss-article-title\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/gi;
  return html.replace(re, (full, inner: string) => {
    // Compare plain text — strip tags and collapse whitespace on both sides.
    const innerText = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const titleText = articleTitle.replace(/\s+/g, " ").trim();
    return innerText === titleText ? "" : full;
  });
}

/** Resolve site-relative links and audio while preserving absolute and fragment URLs. */
function absolutizeUrl(url: string, baseUrl: string): string {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) {
    return url;
  }
  try {
    return new URL(url, baseUrl).href;
  } catch (error) {
    console.warn(`    ⚠️ Could not resolve URL ${url} against ${baseUrl}: ${error}`);
    return url;
  }
}

export function absolutizeRelativeHrefs(html: string, baseUrl: string): string {
  // Linear: scan each <a> tag, then rewrite its href within the short tag
  // string. One regex with [^>]*? … [^>]* around href= backtracks polynomially
  // on hostile input (CodeQL js/polynomial-redos); splitting the scan from the
  // attribute read removes the ambiguity. The function replacer keeps any `$`
  // in the URL literal.
  return html.replace(/<a\b[^>]*>/gi, (tag) =>
    tag.replace(/(\shref=")([^"]+)(")/i, (m, pre: string, href: string, post: string) => {
      const absolute = absolutizeUrl(href, baseUrl);
      return absolute === href ? m : `${pre}${absolute}${post}`;
    }),
  );
}

/** Heading permalinks are site chrome, including the legacy visible # glyph. */
export function stripHeadingAnchors(html: string): string {
  return html.replace(
    /<a\b[^>]*\bclass="[^"]*\bmoss-heading-anchor\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
    "",
  );
}

export function normalizeHtmlForMatters(html: string): string {
  let result = html;

  // Step 0: Remove moss heading-anchor permalinks (web-only chrome whose `#`
  // would otherwise leak into matters' heading text). See stripHeadingAnchors.
  result = stripHeadingAnchors(result);

  // Formula images use the ordinary image upload path. Legacy carriers cannot
  // retain their typeset appearance through the Matters sanitizer.
  refuseLegacyMath(result);

  // Step 1: Collapse h4, h5, h6 → h3 (process these BEFORE h1 to avoid double-shifting)
  result = result.replace(/<(\/?)h[456](\s[^>]*)?>/gi, (_match, slash, attrs) => {
    return `<${slash}h3${attrs || ""}>`;
  });

  // Step 2: Downgrade h1 → h2
  result = result.replace(/<(\/?)h1(\s[^>]*)?>/gi, (_match, slash, attrs) => {
    return `<${slash}h2${attrs || ""}>`;
  });

  // Step 3: Wrap images in matters' required <figure class="image"> shell.
  result = wrapImagesForMatters(result);

  return result;
}

// Attribute-aware scans preserve > inside alt text and hoist source-annotated paragraphs.
const IMAGE_TAG = String.raw`<img\b(?:[^'"<>]|"[^"]*"|'[^']*')*>`;
const PARAGRAPH_OPEN = "<p(?:\\s[^>]*)?>";

/** Matters images require figure.image and a figcaption, even when empty. */
export function wrapImagesForMatters(html: string): string {
  let result = html;

  // Normalize existing image figures before wrapping bare images.
  result = result.replace(
    /<figure\b[^>]*>([\s\S]*?)<\/figure>/gi,
    (full, body: string) => {
      if (!new RegExp(IMAGE_TAG, "i").test(body)) return full;
      const hasFigcap = /<figcaption\b/i.test(body);
      const bodyWithCap = hasFigcap ? body : `${body}<figcaption></figcaption>`;
      return `<figure class="image">${bodyWithCap}</figure>`;
    },
  );

  // Helper: is `offset` inside an open `<figure>` or `<picture>` in `src`?
  // Data URI pictures can be much longer than a fixed lookbehind window.
  const isInside = (src: string, offset: number, tag: "figure" | "picture"): boolean => {
    const preceding = src.toLowerCase();
    const openIdx = preceding.lastIndexOf(`<${tag}`, offset - 1);
    const closeIdx = preceding.lastIndexOf(`</${tag}`, offset - 1);
    return openIdx > closeIdx;
  };

  // Step B: `<p>` containing only a `<picture>` → hoist to a figure wrap.
  // A `<figure>` inside a `<p>` is invalid HTML and matters' parser splits the
  // `<p>` around it, producing stray empty `<p></p>` siblings. Hoist first.
  // The open tag must allow attributes — see PARAGRAPH_OPEN.
  result = result.replace(
    new RegExp(`${PARAGRAPH_OPEN}\\s*(<picture\\b[^>]*>[\\s\\S]*?</picture>)\\s*</p>`, "gi"),
    (_full, picture: string) => `<figure class="image">${picture}<figcaption></figcaption></figure>`,
  );

  // Step C: Wrap remaining standalone `<picture>` blocks (not already inside
  // a `<figure>`). matters normalizes the picture down to just the `<img>` on
  // storage, but the wrap is what saves the image from being stripped.
  result = result.replace(
    /<picture\b[^>]*>[\s\S]*?<\/picture>/gi,
    (full, offset: number) => {
      if (isInside(result, offset, "figure")) return full;
      return `<figure class="image">${full}<figcaption></figcaption></figure>`;
    },
  );

  // Step D: `<p>` containing only an `<img>` → same hoist as Step B.
  result = result.replace(
    new RegExp(`${PARAGRAPH_OPEN}\\s*(${IMAGE_TAG})\\s*</p>`, "gi"),
    (_full, img: string) => `<figure class="image">${img}<figcaption></figcaption></figure>`,
  );

  // Step E: Remaining bare `<img>` tags (not already inside a `<figure>` or
  // `<picture>`). After Step D this is rare — usually an inline image mixed
  // with text. We wrap regardless; matters would strip it otherwise.
  result = result.replace(new RegExp(IMAGE_TAG, "gi"), (imgTag, offset: number) => {
    if (isInside(result, offset, "figure")) return imgTag;
    if (isInside(result, offset, "picture")) return imgTag;
    return `<figure class="image">${imgTag}<figcaption></figcaption></figure>`;
  });

  return result;
}

/** Refuse legacy formulas before the sanitizer can drop or flatten them. */
function refuseLegacyMath(html: string): void {
  const tags = html.match(/<[a-z][a-z0-9-]*\b(?:[^'"<>]|"[^"]*"|'[^']*')*>/gi) ?? [];
  for (const tag of tags) {
    if (/^<img\b/i.test(tag)) continue;
    const classes = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (/^<(?:svg|math)\b/i.test(tag) || /\sdata-moss-math\b/i.test(tag) ||
        (classes?.[1] ?? classes?.[2] ?? classes?.[3] ?? "").split(/\s+/).includes("moss-math")) {
      throw new MattersRefusal("This Matters copy is waiting for formula pictures. Its formulas must be sent as images before it can be published.");
    }
  }
}

/** Matters audio requires figure.audio, a source child and a figcaption.
 * Absolute audio URLs can stream from the site if the optional byte upload fails. */
export function wrapAudioForMatters(html: string, baseUrl: string): string {
  // moss audio is identified by the `moss-embed-audio` class. Capture the inner
  // markup (the `<source>` + fallback text) so we can extract the source.
  const audioPattern =
    '<audio\\b[^>]*\\bclass="[^"]*\\bmoss-embed-audio\\b[^"]*"[^>]*>([\\s\\S]*?)</audio>';

  const buildFigure = (inner: string): string => {
    const srcMatch = inner.match(/<source\b[^>]*\bsrc="([^"]*)"[^>]*>/i);
    const src = srcMatch ? srcMatch[1] : "";
    const typeMatch = inner.match(/<source\b[^>]*\btype="([^"]*)"[^>]*>/i);
    const type = typeMatch ? typeMatch[1] : undefined;

    const absSrc = absolutizeUrl(src, baseUrl);
    const sourceTag = type
      ? `<source src="${absSrc}" type="${type}">`
      : `<source src="${absSrc}">`;
    // A figcaption is mandatory; browser fallback text is not article content.
    return `<figure class="audio"><audio controls>${sourceTag}</audio><figcaption></figcaption></figure>`;
  };

  let result = html;
  // Pass 1: hoist `<p>…audio…</p>` out of the paragraph — a `<figure>` inside a
  // `<p>` is invalid HTML and matters splits the `<p>`, leaving stray empties.
  result = result.replace(
    new RegExp(`${PARAGRAPH_OPEN}\\s*(?:${audioPattern})\\s*</p>`, "gi"),
    (_full, inner: string) => buildFigure(inner),
  );
  // Pass 2: any remaining standalone moss audio.
  result = result.replace(
    new RegExp(audioPattern, "gi"),
    (_full, inner: string) => buildFigure(inner),
  );
  return result;
}

/** Map an image file extension to the MIME type sent on upload. */
export function imageMimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

/** Map an audio file extension to the MIME type sent on upload (mirrors moss-core). */
export function audioMimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    case "m4a":
      return "audio/mp4";
    case "opus":
      return "audio/opus";
    default:
      return "application/octet-stream";
  }
}

/** Decode same-origin URLs into build-file paths; external and data URLs have no local file. */
export function siteRelativePathFromSrc(src: string, baseUrl: string): string | null {
  if (/^data:/i.test(src)) return null;
  let resolved: URL;
  let base: URL;
  try {
    resolved = new URL(src, baseUrl);
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (resolved.origin !== base.origin) return null;
  // pathname is percent-encoded; decode for the filesystem read.
  const path = decodeURIComponent(resolved.pathname.replace(/^\//, ""));
  return path || null;
}

export class PictureFailure extends Error {
  constructor(readonly cause: "network" | "content", message: string) { super(message); }
}

/** Upload every picture, including external URLs, data URIs, and formula images.
 * Failure is fatal before publication; the source site is never a fallback. */
export async function uploadPicture(
  src: string, baseUrl: string, entityId: string, type: "embed" | "cover" = "embed",
  entityType: "draft" | "article" = "draft",
): Promise<{ id: string; path: string }> {
  const label = /^data:/i.test(src) ? `${type} data URI (${src.slice(5, src.indexOf(",")).slice(0, 60)})` : `${type} picture ${src}`;
  try {
    let asset: { id: string; path: string };
    if (/^data:/i.test(src)) {
      const data = /^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]+)$/i.exec(src);
      if (!data) throw new PictureFailure("content", "invalid image data URI");
      let base64: string;
      if (data[2]) {
        base64 = data[3].replace(/\s/g, "");
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
          throw new PictureFailure("content", "invalid base64 image data");
        }
      } else {
        // Encode UTF-8 without requiring a browser DOM.
        base64 = encodeBase64(toUtf8Bytes(decodeURIComponent(data[3])));
      }
      asset = await uploadAssetMultipart(base64, `image.${data[1].split("/")[1].split("+")[0]}`, data[1], type, entityId, entityType);
    } else {
      let url: URL;
      try { url = new URL(src, baseUrl); }
      catch { throw new PictureFailure("content", "invalid image URL"); }
      if (!src.trim() || !["http:", "https:"].includes(url.protocol)) throw new PictureFailure("content", "invalid image URL");
      const local = siteRelativePathFromSrc(src, baseUrl);
      asset = local
        ? await uploadAssetMultipart(await readSiteFile(local), local.split("/").pop() || "image", imageMimeForPath(local), type, entityId, entityType)
        : await uploadAssetByUrl(url.href, type, entityId, entityType);
    }
    if (typeof asset?.id !== "string" || !asset.id.trim() || typeof asset.path !== "string" || !/^https?:\/\//i.test(asset.path)) throw new Error("Matters did not confirm the uploaded asset");
    return asset;
  } catch (error) {
    const cause = error instanceof PictureFailure ? error.cause : error instanceof MattersRefusal || error instanceof URIError ? "content" : "network";
    throw new PictureFailure(cause, `Could not upload ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// The build emits double quotes, but raw HTML can use single/unquoted attributes.
const SRC_ATTRIBUTE = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
function imageSrc(tag: string): string {
  const match = SRC_ATTRIBUTE.exec(tag);
  if (!match) throw new PictureFailure("content", `Picture has no src: ${tag.slice(0, 120)}`);
  return (match[1] ?? match[2] ?? match[3]).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code: string) => String.fromCodePoint(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10)));
}
export async function uploadAndReplaceLocalImages(
  content: string, baseUrl: string, entityId: string, entityType: "draft" | "article" = "draft",
): Promise<string> {
  const replacements = new Map<string, string>();
  const imageTag = new RegExp(IMAGE_TAG, "gi");
  for (const tag of content.match(imageTag) ?? []) {
    const src = imageSrc(tag);
    if (!replacements.has(src)) replacements.set(src, (await uploadPicture(src, baseUrl, entityId, "embed", entityType)).path);
  }
  // Remove source-set alternatives: a browser must not select an original-site image.
  return content.replace(/<picture\b[^>]*>([\s\S]*?)<\/picture>/gi, (_, body: string) => body.replace(/<source\b[^>]*>/gi, ""))
    .replace(imageTag, (tag) => {
      const url = replacements.get(imageSrc(tag))!;
      return tag.replace(SRC_ATTRIBUTE, () => ` src="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)
        .replace(/\ssrcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    });
}

/** Upload local audio opportunistically; its absolute site URL remains a playable fallback. */
export async function uploadAndReplaceLocalAudio(
  content: string,
  baseUrl: string,
  entityId: string,
  entityType: "draft" | "article" = "draft",
): Promise<string> {
  const figureAudioRegex = /<figure\b[^>]*\bclass="audio"[^>]*>([\s\S]*?)<\/figure>/gi;
  // Linear tag scan + per-tag src read — avoids the polynomial backtracking of
  // two [^>]* around src= (CodeQL js/polynomial-redos).
  const sourceTagRegex = /<source\b[^>]*>/gi;
  const srcs = new Set<string>();
  let figure: RegExpExecArray | null;
  while ((figure = figureAudioRegex.exec(content)) !== null) {
    let tag: RegExpExecArray | null;
    while ((tag = sourceTagRegex.exec(figure[1])) !== null) {
      const srcMatch = /\ssrc="([^"]+)"/i.exec(tag[0]);
      if (srcMatch && !/^data:/i.test(srcMatch[1])) srcs.add(srcMatch[1]);
    }
  }
  if (srcs.size === 0) return content;

  const replacements = new Map<string, string>();
  for (const src of srcs) {
    const sitePath = siteRelativePathFromSrc(src, baseUrl);
    if (!sitePath) continue; // external/cross-origin — leave the streamed URL
    try {
      const base64 = await readSiteFile(sitePath);
      const filename = sitePath.split("/").pop() || "audio";
      const asset = await uploadAssetMultipart(base64, filename, audioMimeForPath(sitePath), "embedaudio", entityId, entityType);
      replacements.set(src, asset.path);
      console.log(`    🔊 Audio uploaded (bytes): ${src} → ${asset.path}`);
    } catch (error) {
      // Leave the absolutized deployed URL in place — matters streams from it.
      console.warn(`    ⚠️ Audio byte-upload failed for ${src}, keeping site URL: ${error}`);
    }
  }

  return applySrcReplacements(content, replacements);
}

/** Replace every `src="<original>"` occurrence with the mapped URL. */
function applySrcReplacements(content: string, replacements: Map<string, string>): string {
  let result = content;
  for (const [originalSrc, newUrl] of replacements) {
    const escaped = originalSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`src="${escaped}"`, "g"), `src="${newUrl}"`);
  }
  return result;
}

