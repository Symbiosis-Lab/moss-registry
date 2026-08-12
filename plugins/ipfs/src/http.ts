/**
 * Shared HTTP helpers.
 *
 * ALL IPFS HTTP goes through the moss-api Rust-side helpers (httpPost /
 * httpPostMultipart / fetchUrl), never browser `fetch`. Rationale:
 *   - Pinata (api.pinata.cloud) doesn't send permissive CORS to webview origins.
 *   - A local Kubo node (127.0.0.1:5001) is both mixed-content and a cross-origin
 *     hit on Kubo's Origin-locked RPC.
 * The Rust-side helpers send no browser Origin, sidestepping both.
 *
 * All three return `{ ok, status, text() }` with a SYNCHRONOUS text()
 * (matters/src/api.ts:532-561); parse with JSON.parse(response.text()).
 */

import { httpPost, httpPostMultipart, httpGet, fetchUrl } from "@symbiosis-lab/moss-api";
import type { SiteFile } from "./types";
import { mimeForPath } from "./mime";

/** The shape moss-api response objects share. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): string;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface MultipartFile {
  field: string;
  filename: string;
  contentType: string;
  contentBase64: string;
}

export interface MultipartBody {
  textFields?: Array<{ name: string; value: string }>;
  files: MultipartFile[];
}

/** Parse a JSON response, throwing a readable error on non-2xx / non-JSON. */
export function parseJson<T>(res: HttpResponse): T {
  const text = res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`HTTP ${res.status}: non-JSON response: ${text.slice(0, 200)}`);
  }
}

/** POST a JSON object body and parse the JSON response. */
export async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  opts: RequestOptions = {},
): Promise<T> {
  const res = (await httpPost(url, body, opts)) as unknown as HttpResponse;
  return parseJson<T>(res);
}

/**
 * POST a JSON object body and return the raw response (caller parses).
 * For body-less RPC calls (Kubo), pass {} — the SDK JSON-encodes the body and
 * Kubo ignores it for query-arg commands.
 */
export async function postRaw(
  url: string,
  body: Record<string, unknown>,
  opts: RequestOptions = {},
): Promise<HttpResponse> {
  return (await httpPost(url, body, opts)) as unknown as HttpResponse;
}

/** POST a multipart body and return the raw response (caller parses). */
export async function postMultipart(
  url: string,
  body: MultipartBody,
  opts: RequestOptions = {},
): Promise<HttpResponse> {
  return (await httpPostMultipart(url, body, opts)) as unknown as HttpResponse;
}

/**
 * Turn site files into multipart parts under one field name, with each part's
 * filename carrying the (optional) wrapping-directory prefix so the pinning
 * backend reconstructs the directory tree and returns ONE directory CID.
 */
export function toMultipartFiles(
  files: SiteFile[],
  field: string,
  prefix = "",
): MultipartFile[] {
  const pre = prefix ? prefix.replace(/\/$/, "") + "/" : "";
  return files.map((f) => ({
    field,
    filename: `${pre}${f.path}`,
    contentType: mimeForPath(f.path),
    contentBase64: f.base64,
  }));
}

/** GET a URL via the Rust-side fetch; returns { ok, status } (CORS-free). */
export async function getUrl(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number }> {
  try {
    const res = (await fetchUrl(url, { timeoutMs })) as unknown as {
      ok: boolean;
      status: number;
    };
    return { ok: !!res.ok, status: res.status ?? 0 };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * GET with request headers (CORS-free). Unlike getUrl/fetchUrl, this can carry
 * an Authorization header — used for authenticated pre-flight checks.
 * Returns status 0 on transport failure.
 */
export async function getWithHeaders(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number }> {
  try {
    const res = (await httpGet(url, { headers, timeoutMs })) as unknown as HttpResponse;
    return { ok: !!res.ok, status: res.status ?? 0 };
  } catch {
    return { ok: false, status: 0 };
  }
}
