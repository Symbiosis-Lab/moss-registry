/**
 * X channel: posts one copy per call, as moss's syndication contract asks.
 * moss decides what is due and shapes the text. With no API keys, X's own
 * composer opens prefilled and the author presses Post; with them, this posts
 * through X's v2 API, signed with OAuth 1.0a.
 */

import { getSecret, openBrowser } from "@symbiosis-lab/moss-api";
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
    handoff?: { text: string; open_url?: string };
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

const KEYS = ["api_key", "api_key_secret", "access_token", "access_token_secret"];

async function account(job: CopyJob): Promise<Account> {
  const api = String(job.config.api ?? "").replace(/\/+$/, "");
  if (!allowed(api)) throw new ApiError(401, `the api setting may name only ${API} or a local test server, not ${api}`);
  const [consumerKey, consumerSecret, token, tokenSecret] = await Promise.all(KEYS.map(getSecret));
  if (!consumerKey || !consumerSecret || !token || !tokenSecret) throw new ApiError(401, "connect X first: your app's API key and secret, and the access token and secret for your account");
  return { api, credentials: { consumerKey, consumerSecret, token, tokenSecret } };
}

async function call(a: Account, method: string, path: string, body?: unknown): Promise<any> {
  const url = `${a.api}${path}`;
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const r = await fetch(url, {
    method,
    headers: { authorization: await authorization(method, url, a.credentials, nonce, Math.floor(Date.now() / 1000)), ...(body ? { "content-type": "application/json" } : {}) },
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

const COMPOSER = "https://x.com/intent/post";

/**
 * X's composer, filled with the first post, in moss's panel. The composer takes
 * one post, so a thread's later parts come back as text to add as replies.
 * The copy waits until its address is listed under syndicated:.
 */
async function compose(job: CopyJob): Promise<CopyResult> {
  const [first, ...rest] = job.parts ?? [];
  if (!first) return { success: false, message: "the copy has no text", copy: { refused: { cause: "content", message: "the copy has no text" } } };
  const open_url = `${COMPOSER}?text=${encodeURIComponent(first.text)}`;
  try {
    // One composer at a time: the next copy waits for this panel to close.
    await (await openBrowser(open_url)).closed;
  } catch {
    // Without the app there is no panel; the address alone opens the composer.
  }
  return { success: true, copy: { handoff: { text: rest.map((p) => p.text).join("\n\n"), open_url } } };
}

export async function publish_copy(job: CopyJob): Promise<CopyResult> {
  if ((await Promise.all(KEYS.map(getSecret))).every((k) => !k)) return compose(job);
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

interface Post {
  id: string;
  text: string;
  referenced_tweets?: { type: string; id: string }[];
  entities?: { urls?: { url: string; expanded_url?: string }[] };
}

/** A post's text as it was sent: X escapes `& < >` and shows each link as a short one of its own, whose address it lists. */
function sentText(p: Post): string {
  let text = p.text;
  for (const u of p.entities?.urls ?? []) if (u.expanded_url) text = text.split(u.url).join(u.expanded_url);
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/**
 * The answer when the copy cannot be recognised among the latest posts: it
 * may be older than they are, or its text edited since the send, and moss
 * posts again on "none", so it is told nothing is certain instead.
 */
const unsure = (why: string): CopyResult => ({
  success: false,
  message: `${why}. Listing the copy under syndicated: tracks only its first post, so removing it later leaves a thread's replies; with --retry-copies, any of it that is there is posted twice`,
});

/**
 * The copy among the account's latest posts: each part's text, each a reply
 * to the part before. Each look-up is two billed reads.
 */
export async function find_copy(job: CopyJob): Promise<CopyResult> {
  try {
    const a = await account(job);
    const me = (await call(a, "GET", "/2/users/me")).data;
    const latest: Post[] = (await call(a, "GET", `/2/users/${me.id}/tweets?max_results=20&tweet.fields=referenced_tweets,entities`)).data ?? [];
    const repliesTo = (p: Post) => p.referenced_tweets?.find((r) => r.type === "replied_to")?.id;
    const parts = job.parts ?? [];
    const chain: string[] = [];
    for (const part of parts) {
      const matches = latest.filter((p) => same(sentText(p), part.text) && repliesTo(p) === chain[chain.length - 1]);
      if (matches.length > 1) return unsure(`${matches.length} posts match part ${chain.length + 1} of the copy`);
      if (!matches.length) return unsure(chain.length ? `only ${chain.length} of the thread's ${parts.length} parts are among the latest posts` : "none of the latest posts is the copy");
      chain.push(matches[0].id);
    }
    // The post may have lost parts since the send, or the author replied to the copy: either way it is not certain which posts are the copy.
    if (latest.some((p) => repliesTo(p) === chain[chain.length - 1])) return unsure("the copy goes on past the post's last part among the latest posts");
    const [first, ...rest] = chain;
    return { success: true, copy: { id: first, url: address(first), parts: rest.map((id) => ({ id, url: address(id) })) } };
  } catch (e) {
    return refused(e);
  }
}

export async function delete_copy(job: CopyJob): Promise<CopyResult> {
  try {
    const previous = job.previous;
    if (!previous) return { success: true };
    const a = await account(job);
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
