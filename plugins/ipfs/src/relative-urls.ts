/**
 * Root-absolute → relative URL rewriting for gateway portability.
 *
 * moss emits root-absolute paths (href="/_moss/style.css", href="/about/"),
 * which only resolve when the site is mounted at an origin root — true on
 * subdomain gateways, false on every path-form gateway
 * (host/ipfs/<cid>/…), where "/…" escapes the site: unstyled pages, dead
 * navigation (verified live). Rewriting to depth-relative URLs makes the same
 * build render correctly on ANY gateway form.
 *
 * Scope is deliberately narrow and rendering-critical only:
 * - href/src/srcset attributes with a leading "/" (not "//") are rewritten;
 * - content= meta values (og:url, og:image) are left alone — social scrapers
 *   need fully-qualified URLs, which relative paths wouldn't fix;
 * - scripts/CSS bodies are not touched (the built site has no absolute CSS
 *   url() refs; one JS previews fetch degrades gracefully).
 *
 * Base64/UTF-8 codecs are pure JS: the plugin runs under QuickJS in CLI mode,
 * where atob/TextDecoder are not guaranteed.
 */

import type { SiteFile } from "./types";
import { sizeFromBase64 } from "./site-files";

// ---------------------------------------------------------------------------
// Pure-JS base64 + UTF-8 (QuickJS-safe)
// ---------------------------------------------------------------------------

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64_ALPHABET.length; i++) B64_LOOKUP[B64_ALPHABET[i]] = i;

export function base64ToBytesJs(b64: string): Uint8Array {
  const clean = b64.replace(/[\s=]+$/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_LOOKUP[clean[i]];
    if (v === undefined) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

export function bytesToBase64Js(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 63] : "=";
  }
  return out;
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    let cp: number;
    if (b0 < 0x80) cp = b0;
    else if (b0 < 0xe0) cp = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b0 < 0xf0) cp = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else {
      cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
    }
    if (cp > 0xffff) {
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      out += String.fromCharCode(cp);
    }
  }
  return out;
}

export function utf8Encode(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

/** Depth-relative prefix for a page at `path` ("posts/a/index.html" → "../../"). */
export function relativePrefixFor(path: string): string {
  const depth = path.split("/").length - 1;
  return depth === 0 ? "./" : "../".repeat(depth);
}

/** One srcset value can hold several URLs: rewrite each leading-"/" candidate. */
function rewriteSrcset(value: string, prefix: string): string {
  return value
    .split(",")
    .map((part) => part.replace(/^(\s*)\/(?!\/)/, `$1${prefix}`))
    .join(",");
}

/**
 * Rewrite root-absolute href/src/srcset URLs in one HTML document to be
 * relative to `prefix`. Protocol-relative ("//…"), absolute ("https://…"),
 * fragment, and mailto URLs are untouched, as are content= meta values.
 */
export function rewriteHtmlAbsoluteUrls(html: string, prefix: string): string {
  let out = html.replace(/(\b(?:href|src)=")\/(?!\/)/g, `$1${prefix}`);
  out = out.replace(
    /(\bsrcset=")([^"]*)(")/g,
    (_m, open: string, value: string, close: string) => open + rewriteSrcset(value, prefix) + close,
  );
  return out;
}

/**
 * Make every HTML file in the site relative-URL clean; other files pass
 * through untouched. Returns the number of files rewritten.
 */
export function makeSiteRelative(files: SiteFile[]): { files: SiteFile[]; rewritten: number } {
  let rewritten = 0;
  const result = files.map((f) => {
    if (!/\.html?$/i.test(f.path)) return f;
    const html = utf8Decode(base64ToBytesJs(f.base64));
    const next = rewriteHtmlAbsoluteUrls(html, relativePrefixFor(f.path));
    if (next === html) return f;
    rewritten++;
    const base64 = bytesToBase64Js(utf8Encode(next));
    return { ...f, base64, size: sizeFromBase64(base64) };
  });
  return { files: result, rewritten };
}
