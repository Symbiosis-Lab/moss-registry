/**
 * Extension → MIME type mapping for common web assets.
 *
 * Used for the multipart `contentType` field on upload. (On IPFS the gateway
 * infers content-type from the path, so this is best-effort; in CAR mode it is
 * unused entirely.)
 */

const MIME_BY_EXT: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  map: "application/json",
  xml: "application/xml",
  txt: "text/plain",
  md: "text/markdown",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  wasm: "application/wasm",
};

const DEFAULT_MIME = "application/octet-stream";

/** Return the MIME type for a file path based on its extension. */
export function mimeForPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot === path.length - 1) return DEFAULT_MIME;
  const ext = path.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? DEFAULT_MIME;
}
