/**
 * LinkedIn channel: posts one copy per call, as moss's syndication contract
 * asks. moss decides what is due and shapes the text; this turns a job into a
 * post on the author's own member profile through LinkedIn's Posts API.
 */

import { getSecret, onEvent, openBrowser, openBrowserWithHtml } from "@symbiosis-lab/moss-api";
import { listedByAddress, refusedContent, writeArticle, type Article } from "../../article-handoff";

export interface Part {
  text: string;
  links: string[];
}

export interface CopyJob {
  op: "publish" | "update" | "delete" | "find";
  channel: string;
  idempotency_key: string;
  post: { url: string; source_path: string; title: string; lang?: string | null; date?: string | null };
  form?: "short" | "thread" | "teaser" | "long";
  parts?: Part[];
  article?: Article | null;
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

/**
 * The API version every call names. LinkedIn retires each version a year
 * after its release, so this moves with each plugin release.
 */
export const VERSION = "202610";

/** An answer the API gave, with the HTTP status that says what kind it was. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Account {
  api: string;
  token: string;
}

interface Answer {
  data: any;
  headers: { get(name: string): string | null };
}

const API = "https://api.linkedin.com";

/** The `api` setting is there so tests can use a local stand-in; it never sends the token anywhere else. */
const allowed = (api: string) => api === API || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api);

async function account(job: CopyJob): Promise<Account> {
  const api = String(job.config.api ?? "").replace(/\/+$/, "");
  if (!allowed(api)) throw new ApiError(401, `the api setting may name only ${API} or a local test server, not ${api}`);
  const token = await getSecret("access_token");
  if (!token) throw new ApiError(401, "connect LinkedIn first: an access token from your LinkedIn app");
  return { api, token };
}

async function call(a: Account, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  const r = await fetch(`${a.api}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${a.token}`,
      "Linkedin-Version": VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!r.ok) throw new ApiError(r.status, data?.message ?? `${method} ${path} answered ${r.status}`);
  return { data, headers: r.headers };
}

/** LinkedIn's "little text" reads these characters as markup, unless each is escaped. */
export const littleText = (s: string) => s.replace(/[|{}@[\]()<>#\\*_~]/g, (c) => `\\${c}`);

const address = (urn: string) => `https://www.linkedin.com/feed/update/${urn}/`;
const postPath = (urn: string) => `/rest/posts/${encodeURIComponent(urn)}`;

/**
 * A refusal the API stated: nothing was posted, so moss may send again. Any
 * other failure leaves it unknown whether a post exists, so it is thrown;
 * LinkedIn lets an app list a member's posts only with a permission it grants
 * to approved partners, so moss leaves such a copy for the author to confirm.
 */
const stated = (e: unknown): e is ApiError => e instanceof ApiError && [400, 401, 403, 422, 429].includes(e.status);

function refused(e: unknown): CopyResult {
  if (stated(e)) {
    const cause: Cause = e.status === 401 || e.status === 403 ? "auth" : e.status === 429 ? "rate" : "content";
    return { success: false, message: e.message, copy: { refused: { cause, message: e.message } } };
  }
  throw e;
}

/** LinkedIn's API makes posts, not articles: an article goes through its own editor. */
const ARTICLES = { name: "LinkedIn", url: "https://www.linkedin.com/article/new/" };

export async function publish_copy(job: CopyJob): Promise<CopyResult> {
  if (job.form === "long") return writeArticle({ openBrowser, openBrowserWithHtml, onEvent }, job.article, ARTICLES);
  let a: Account;
  let author: string;
  try {
    a = await account(job);
    // The member's id, from the sign-in scopes `openid profile`.
    author = `urn:li:person:${(await call(a, "GET", "/v2/userinfo")).data.sub}`;
  } catch (e) {
    // Nothing is posted yet, so any failure here may be sent again.
    if (stated(e)) return refused(e);
    return { success: false, message: String(e), copy: { refused: { cause: "network", message: String(e) } } };
  }
  const body: Record<string, unknown> = {
    author,
    commentary: littleText(job.parts?.[0]?.text ?? ""),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  // LinkedIn makes no card from a link in the text; an article card is sent whole.
  if (job.form === "teaser" && job.teaser) body.content = { article: { source: job.teaser.url, title: job.teaser.title, description: job.teaser.description } };
  try {
    const urn = (await call(a, "POST", "/rest/posts", body)).headers.get("x-restli-id");
    if (!urn) throw new Error("LinkedIn accepted the post but did not say its id");
    return { success: true, copy: { id: urn, url: address(urn), parts: [] } };
  } catch (e) {
    return refused(e);
  }
}

/** Edit the copy's text in place. Its card cannot change, since LinkedIn edits only a post's text. */
export async function update_copy(job: CopyJob): Promise<CopyResult> {
  const previous = job.previous;
  if (!previous) return { success: false, message: "no copy to edit", copy: { refused: { cause: "unknown", message: "no copy to edit" } } };
  if (listedByAddress(previous)) return refusedContent(`edit it on LinkedIn: ${previous.url}`);
  try {
    const a = await account(job);
    await call(a, "POST", postPath(previous.id), { patch: { $set: { commentary: littleText(job.parts?.[0]?.text ?? "") } } }, { "X-RestLi-Method": "PARTIAL_UPDATE" });
    return { success: true, copy: { id: previous.id, url: previous.url, parts: [] } };
  } catch (e) {
    return refused(e);
  }
}

export async function delete_copy(job: CopyJob): Promise<CopyResult> {
  try {
    const previous = job.previous;
    if (!previous) return { success: true };
    if (listedByAddress(previous)) return refusedContent(`remove it on LinkedIn: ${previous.url}`);
    const a = await account(job);
    // LinkedIn answers a post already deleted as it answers one it deletes.
    await call(a, "DELETE", postPath(previous.id), undefined, { "X-RestLi-Method": "DELETE" });
    return { success: true };
  } catch (e) {
    return refused(e);
  }
}

// No find_copy: see `stated` above.
const LinkedinPlugin = { publish_copy, update_copy, delete_copy };
(globalThis as unknown as { LinkedinPlugin: typeof LinkedinPlugin }).LinkedinPlugin = LinkedinPlugin;
export default LinkedinPlugin;
