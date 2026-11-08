/**
 * Mastodon channel: posts one copy per call, as moss's syndication contract
 * asks. moss decides what is due and shapes the text; this turns a job into
 * statuses on the author's own account, through the Mastodon client API that
 * Mastodon, GoToSocial and other servers share.
 */

import { getSecret } from "@symbiosis-lab/moss-api";

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

interface Status {
  id: string;
  url: string | null;
  uri: string;
  content: string;
  in_reply_to_id: string | null;
}

/** An answer the server gave, with the HTTP status that says what kind it was. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Account {
  server: string;
  token: string;
}

async function account(job: CopyJob): Promise<Account> {
  const server = String(job.config.server ?? "").replace(/\/+$/, "");
  const token = await getSecret("access_token");
  if (!server || !token) throw new ApiError(401, "connect Mastodon first: your server's address and an access token");
  return { server, token };
}

async function call(a: Account, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<any> {
  const r = await fetch(`${a.server}${path}`, {
    method,
    headers: { authorization: `Bearer ${a.token}`, ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!r.ok) throw new ApiError(r.status, data?.error ?? `${method} ${path} answered ${r.status}`);
  return data;
}

const address = (s: Status) => s.url ?? s.uri;

/**
 * A refusal the server stated: nothing was posted, so moss may send again.
 * Any other failure leaves it unknown whether a status exists, so it is
 * thrown and moss looks the copy up before sending again.
 */
const stated = (e: unknown): e is ApiError => e instanceof ApiError && [400, 401, 403, 413, 422, 429].includes(e.status);

function refused(e: unknown): CopyResult {
  if (stated(e)) {
    const cause: Cause = e.status === 401 || e.status === 403 ? "auth" : e.status === 429 ? "rate" : "content";
    return { success: false, message: e.message, copy: { refused: { cause, message: e.message } } };
  }
  throw e;
}

/** A status's text as its author wrote it, from the HTML the server renders. */
export function plainText(html: string): string {
  return html
    // Servers shorten a link's visible text; its address is what was posted.
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (whole, href, inner) => (/^[#@]/.test(inner.replace(/<[^>]+>/g, "")) ? whole : href))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

export async function publish_copy(job: CopyJob): Promise<CopyResult> {
  let a: Account;
  try {
    a = await account(job);
  } catch (e) {
    return refused(e);
  }
  const parts = job.parts ?? [];
  const posted: Status[] = [];
  try {
    for (let i = 0; i < parts.length; i++) {
      const body: Record<string, unknown> = { status: parts[i].text, visibility: "public" };
      if (job.post.lang) body.language = job.post.lang;
      if (i > 0) body.in_reply_to_id = posted[i - 1].id;
      // Servers that keep the key (Mastodon, for about an hour) drop a repeat.
      posted.push(await call(a, "POST", "/api/v1/statuses", body, { "Idempotency-Key": `${job.idempotency_key}-${i}` }));
    }
  } catch (e) {
    // A thread refused part way is taken down again, so the next run can
    // send it whole; if that fails too, moss is told nothing is certain.
    if (posted.length && stated(e)) {
      for (const s of [...posted].reverse()) await call(a, "DELETE", `/api/v1/statuses/${s.id}`);
    }
    return refused(e);
  }
  const [first, ...rest] = posted;
  return { success: true, copy: { id: first.id, url: address(first), parts: rest.map((s) => ({ id: s.id, url: address(s) })) } };
}

/** How far the author's statuses since a copy are read before the copy is called uncertain: an interrupted send is looked up at the next publish. */
const PAGE = 40;
const PAGES = 10;

/** Mastodon's ids are numbers and GoToSocial's are ULIDs; both sort by length, then character by character. */
const later = (a: string, b: string) => (a.length !== b.length ? a.length > b.length : a > b);

/** The author's own statuses after `id`, or null when there are more than this reads. */
async function statusesAfter(a: Account, me: string, id: string): Promise<Status[] | null> {
  const all: Status[] = [];
  let after = id;
  for (let page = 0; page < PAGES; page++) {
    const batch: Status[] = await call(a, "GET", `/api/v1/accounts/${me}/statuses?limit=${PAGE}&min_id=${after}`);
    all.push(...batch);
    if (batch.length < PAGE) return all;
    after = batch.reduce((max, s) => (later(s.id, max) ? s.id : max), after);
  }
  return null;
}

/**
 * The answer when the copy cannot be recognised. A status carries nothing a
 * client chose, only its text, and the text may have been edited since the
 * send; moss posts again on "none", so it is told nothing is certain instead.
 */
const unsure = (why: string): CopyResult => ({
  success: false,
  message: `${why}. Listing the copy under syndicated: tracks only its first status, so removing it later leaves a thread's replies; with --retry-copies, any of it that is there is posted twice`,
});

/**
 * The copy among the account's recent statuses: the one status with its first
 * part's text or a link to the post, then each later part as the author's
 * reply to the part before.
 */
export async function find_copy(job: CopyJob): Promise<CopyResult> {
  try {
    const a = await account(job);
    const me = await call(a, "GET", "/api/v1/accounts/verify_credentials");
    const statuses: Status[] = await call(a, "GET", `/api/v1/accounts/${me.id}/statuses?limit=40&exclude_replies=true`);
    const parts = job.parts ?? [];
    const matches = statuses.filter((s) => !s.in_reply_to_id && (same(plainText(s.content), parts[0]?.text ?? "") || s.content.includes(`href="${job.post.url}"`)));
    if (matches.length !== 1) return unsure(matches.length ? `${matches.length} statuses match the copy` : "no recent status matches the copy");
    const chain = [matches[0]];
    // The author's own statuses, not the replies under the copy: a server cuts that list before dropping muted accounts, so it can hide the copy's own.
    const since = await statusesAfter(a, me.id, chain[0].id);
    if (!since) return unsure(`the account has more than ${PAGE * PAGES} statuses since the copy`);
    const replies = (s: Status) => since.filter((d) => d.in_reply_to_id === s.id);
    for (const part of parts.slice(1)) {
      const next = replies(chain[chain.length - 1]).find((s) => same(plainText(s.content), part.text));
      if (!next) return unsure(`only ${chain.length} of the thread's ${parts.length} parts are on the account`);
      chain.push(next);
    }
    // The post may have lost parts since the send, or the author replied to the copy: either way it is not certain which statuses are the copy.
    if (replies(chain[chain.length - 1]).length) return unsure("the copy on the account goes on past the post's last part");
    const [first, ...rest] = chain;
    return { success: true, copy: { id: first.id, url: address(first), parts: rest.map((s) => ({ id: s.id, url: address(s) })) } };
  } catch (e) {
    return refused(e);
  }
}

/** Edit each status of the copy in place. A thread can change its words, not its number of parts. */
export async function update_copy(job: CopyJob): Promise<CopyResult> {
  const previous = job.previous;
  const parts = job.parts ?? [];
  if (!previous) return { success: false, message: "no copy to edit", copy: { refused: { cause: "unknown", message: "no copy to edit" } } };
  const ids = [previous.id, ...(previous.parts ?? []).map((p) => p.id)];
  if (ids.length !== parts.length) {
    const message = `the thread now has ${parts.length} parts and its copy ${ids.length}; Mastodon can edit a status but not add or remove one`;
    return { success: false, message, copy: { refused: { cause: "content", message } } };
  }
  try {
    const a = await account(job);
    for (let i = 0; i < ids.length; i++) {
      const body: Record<string, unknown> = { status: parts[i].text };
      if (job.post.lang) body.language = job.post.lang;
      await call(a, "PUT", `/api/v1/statuses/${ids[i]}`, body);
    }
    return { success: true, copy: { id: previous.id, url: previous.url, parts: previous.parts ?? [] } };
  } catch (e) {
    return refused(e);
  }
}

export async function delete_copy(job: CopyJob): Promise<CopyResult> {
  try {
    const a = await account(job);
    const previous = job.previous;
    if (!previous) return { success: true };
    for (const id of [...(previous.parts ?? []).map((p) => p.id).reverse(), previous.id]) {
      try {
        await call(a, "DELETE", `/api/v1/statuses/${id}`);
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

const MastodonPlugin = { publish_copy, find_copy, update_copy, delete_copy };
(globalThis as unknown as { MastodonPlugin: typeof MastodonPlugin }).MastodonPlugin = MastodonPlugin;
export default MastodonPlugin;
