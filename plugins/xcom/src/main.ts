/**
 * X channel: posts one copy per call, as moss's syndication contract asks.
 * moss decides what is due and shapes the text; this turns a job into posts on
 * the author's own account through X's v2 API, signed with OAuth 1.0a.
 */

import { getSecret } from "@symbiosis-lab/moss-api";
import { authorization, type Credentials } from "./oauth1";

export interface Part {
  text: string;
  links: string[];
}

export interface CopyJob {
  op: "publish" | "update" | "delete" | "find";
  channel: string;
  idempotency_key: string;
  post: { url: string; source_path: string; title: string; lang?: string | null; date?: string | null };
  form?: "short" | "thread" | "teaser";
  parts?: Part[];
  teaser?: { title: string; description: string; url: string; cover?: string | null } | null;
  previous?: { id: string; url: string; parts?: { id: string; url: string }[] } | null;
  config: Record<string, unknown>;
}

type Cause = "auth" | "content" | "rate" | "network" | "unknown";

export interface CopyResult {
  success: boolean;
  message?: string;
  copy?: {
    id?: string;
    url?: string;
    parts?: { id: string; url: string }[];
    refused?: { cause: Cause; message?: string };
  } | null;
}

/** An answer the API gave, with its HTTP status and problem type. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type = "",
  ) {
    super(message);
  }
}

interface Account {
  api: string;
  credentials: Credentials;
}

const API = "https://api.x.com";

/** The `api` setting is there so tests can use a local stand-in; it never sends credentials anywhere else. */
const allowed = (api: string) => api === API || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api);

async function account(job: CopyJob): Promise<Account> {
  const api = String(job.config.api ?? "").replace(/\/+$/, "");
  if (!allowed(api)) throw new ApiError(401, `the api setting may name only ${API} or a local test server, not ${api}`);
  const [consumerKey, consumerSecret, token, tokenSecret] = await Promise.all(["api_key", "api_key_secret", "access_token", "access_token_secret"].map(getSecret));
  if (!consumerKey || !consumerSecret || !token || !tokenSecret) throw new ApiError(401, "connect X first: your app's API key and secret, and the access token and secret for your account");
  return { api, credentials: { consumerKey, consumerSecret, token, tokenSecret } };
}

async function call(a: Account, method: string, path: string, body?: unknown): Promise<any> {
  const url = `${a.api}${path}`;
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const r = await fetch(url, {
    method,
    headers: { authorization: authorization(method, url, a.credentials, nonce, Math.floor(Date.now() / 1000)), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!r.ok) throw new ApiError(r.status, data?.detail ?? data?.title ?? data?.message ?? `${method} ${path} answered ${r.status}`, data?.type ?? "");
  return data;
}

/** X answers a post's own address under any account name. */
const address = (id: string) => `https://x.com/i/status/${id}`;

/**
 * A refusal the API stated: nothing was posted, so moss may send again. Any
 * other failure leaves it unknown whether a post exists, so it is thrown and
 * moss looks the copy up before sending again.
 */
const stated = (e: unknown): e is ApiError => e instanceof ApiError && [400, 401, 402, 403, 429].includes(e.status);

function cause(e: ApiError): Cause {
  if (e.status === 401) return "auth";
  // 402 is spent credits on pay-per-use; 429 also covers a usage cap.
  if (e.status === 402 || e.status === 429) return "rate";
  // A 403 is the app's standing (wrong project, no write access) or the post itself (a duplicate).
  if (e.status === 403 && /client-forbidden|unsupported-authentication/.test(e.type)) return "auth";
  return "content";
}

function refused(e: unknown): CopyResult {
  if (stated(e)) return { success: false, message: e.message, copy: { refused: { cause: cause(e), message: e.message } } };
  throw e;
}

export async function publish_copy(job: CopyJob): Promise<CopyResult> {
  let a: Account;
  try {
    a = await account(job);
  } catch (e) {
    return refused(e);
  }
  const parts = job.parts ?? [];
  const posted: string[] = [];
  try {
    for (let i = 0; i < parts.length; i++) {
      const body: Record<string, unknown> = { text: parts[i].text };
      if (i > 0) body.reply = { in_reply_to_tweet_id: posted[i - 1] };
      posted.push((await call(a, "POST", "/2/tweets", body)).data.id);
    }
  } catch (e) {
    // A thread refused part way is taken down again, so the next run can
    // send it whole; if that fails too, moss is told nothing is certain.
    if (posted.length && stated(e)) {
      for (const id of [...posted].reverse()) await call(a, "DELETE", `/2/tweets/${id}`);
    }
    return refused(e);
  }
  const [first, ...rest] = posted;
  return { success: true, copy: { id: first, url: address(first), parts: rest.map((id) => ({ id, url: address(id) })) } };
}

/** X escapes `& < >` in a post's text and replaces every address with its own short link, so texts are compared with both undone. */
const masked = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/https?:\/\/\S+/g, "<link>").replace(/\s+/g, " ").trim();

interface Post {
  id: string;
  text: string;
  referenced_tweets?: { type: string; id: string }[];
}

/**
 * The copy among the account's latest posts: each part's text, each a reply
 * to the part before. A thread found cut short is taken down, as a send
 * refused part way is, so the next send posts it whole. Each look-up is two
 * billed reads.
 */
export async function find_copy(job: CopyJob): Promise<CopyResult> {
  try {
    const a = await account(job);
    const me = (await call(a, "GET", "/2/users/me")).data;
    const latest: Post[] = (await call(a, "GET", `/2/users/${me.id}/tweets?max_results=20&tweet.fields=referenced_tweets`)).data ?? [];
    const repliesTo = (p: Post) => p.referenced_tweets?.find((r) => r.type === "replied_to")?.id;
    const parts = job.parts ?? [];
    const chain: string[] = [];
    for (const part of parts) {
      const found = latest.find((p) => masked(p.text) === masked(part.text) && repliesTo(p) === chain[chain.length - 1]);
      if (!found) break;
      chain.push(found.id);
    }
    if (chain.length < parts.length) {
      for (const id of [...chain].reverse()) await call(a, "DELETE", `/2/tweets/${id}`);
      return { success: true, copy: null };
    }
    const [first, ...rest] = chain;
    return { success: true, copy: { id: first, url: address(first), parts: rest.map((id) => ({ id, url: address(id) })) } };
  } catch (e) {
    return refused(e);
  }
}

export async function delete_copy(job: CopyJob): Promise<CopyResult> {
  try {
    const a = await account(job);
    // moss sends every delete with the copy it removes.
    const previous = job.previous!;
    for (const id of [...(previous.parts ?? []).map((p) => p.id).reverse(), previous.id]) {
      try {
        await call(a, "DELETE", `/2/tweets/${id}`);
      } catch (e) {
        // Already gone is what was asked for.
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    }
    return { success: true };
  } catch (e) {
    return refused(e);
  }
}

// X edits a post only within 30 minutes of posting it, and each edit makes a
// new post, so there is no update_copy: moss reports such a copy as one that
// cannot be edited.
const XcomPlugin = { publish_copy, find_copy, delete_copy };
(globalThis as unknown as { XcomPlugin: typeof XcomPlugin }).XcomPlugin = XcomPlugin;
export default XcomPlugin;
