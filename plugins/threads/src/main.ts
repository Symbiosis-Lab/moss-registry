import { account, call, id, ready, Refusal, refusal, remove, type Account } from "./api";
import type { CopyJob, CopyResult } from "./types";
export type { CopyJob, CopyResult } from "./types";

interface Post { id: string; permalink: string; text: string; is_reply: boolean; replied_to?: { id: string } | null }
const fields = "id,text,permalink,is_reply,replied_to";

function remote(p: Post): { id: string; url: string } {
  id(p);
  if (typeof p.permalink !== "string" || !/^https:\/\/(?:www\.)?threads\.(?:net|com)\/[^\s?#]+$/.test(p.permalink)) {
    throw new Error("Threads did not return a valid permalink");
  }
  return { id: p.id, url: p.permalink };
}

function copy(posts: Post[]): CopyResult {
  const [first, ...parts] = posts.map(remote);
  if (!first) throw new Error("Threads copy has no posts");
  return { success: true, copy: { ...first, parts } };
}

export async function publish_copy(job: CopyJob): Promise<CopyResult> {
  let a: Account;
  const parts = job.parts ?? [];
  try {
    a = await account(job);
    if (!job.form || !["short", "thread", "teaser"].includes(job.form) || !parts.length
      || (job.form !== "thread" && parts.length !== 1)
      || parts.some((p) => !p.text.trim() || p.text.length > 500)
      || (job.form === "teaser" && !job.teaser?.url)) {
      throw new Refusal("content", "Threads needs nonempty shaped text within 500 UTF-16 units per part and a link for a teaser");
    }
  } catch (e) { return refusal(e); }

  const posted: string[] = [];
  for (const part of parts) {
    let container: string;
    try {
      container = id(await call(a, "POST", "/me/threads", {
        media_type: "TEXT", text: part.text,
        ...(posted.length ? { reply_to_id: posted[posted.length - 1] } : {}),
        ...(job.form === "teaser" ? { link_attachment: job.teaser!.url } : {}),
      }));
      await ready(a, container);
    } catch (e) {
      // Containers are unpublished. A later transport loss still leaves the already-published prefix uncertain.
      if (posted.length && !(e instanceof Refusal)) throw e;
      for (const published of [...posted].reverse()) await remove(a, published);
      return refusal(e);
    }
    try {
      posted.push(id(await call(a, "POST", "/me/threads_publish", { creation_id: container })));
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      for (const published of [...posted].reverse()) await remove(a, published);
      return refusal(e);
    }
  }
  // Anything failing after publication throws, even an explicit lookup refusal.
  const posts: Post[] = [];
  for (const published of posted) posts.push(await call(a, "GET", `/${published}?fields=${fields}`));
  return copy(posts);
}

/** A bounded listing can prove a complete match, never absence. No pagination URL is followed with the credential. */
export async function find_copy(job: CopyJob): Promise<CopyResult> {
  const a = await account(job);
  const parts = job.parts ?? [];
  if (!parts.length) throw new Error("Threads recovery needs the original shaped text");
  let posts: Post[];
  if (job.previous) {
    posts = [];
    for (const p of [job.previous, ...(job.previous.parts ?? [])]) {
      posts.push(await call(a, "GET", `/${encodeURIComponent(p.id)}?fields=${fields}`));
    }
  } else {
    const result = await call(a, "GET", `/me/threads?fields=${fields}&limit=100`);
    if (!Array.isArray(result?.data)) throw new Error("Threads recovery listing is unreadable");
    posts = result.data;
  }
  const chain: Post[] = [];
  for (const part of parts) {
    const parent = chain[chain.length - 1]?.id;
    const matches = posts.filter((p) => p.text === part.text && (parent
      ? p.is_reply === true && p.replied_to?.id === parent
      : p.is_reply === false && !p.replied_to));
    if (matches.length !== 1) throw new Error("Threads recovery is partial, absent from the bounded listing, or ambiguous; confirm the copy before retrying");
    chain.push(matches[0]);
  }
  if (posts.some((p) => p.replied_to?.id === chain[chain.length - 1].id)) throw new Error("Threads copy has unexpected replies; confirm it before retrying");
  return copy(chain);
}

export async function delete_copy(job: CopyJob): Promise<CopyResult> {
  if (!job.previous) return { success: true };
  const a = await account(job);
  for (const p of [...(job.previous.parts ?? [])].reverse().concat(job.previous)) await remove(a, p.id);
  return { success: true };
}

/** The account moss keeps each copy with. */
export async function copy_account(query: { channel: string; config: Record<string, unknown> }): Promise<CopyResult> {
  try {
    const a = await account(query);
    return { success: true, copy: { account: id(await call(a, "GET", "/me?fields=id")) } };
  } catch (e) { return refusal(e); }
}

const ThreadsPlugin = { publish_copy, find_copy, delete_copy, copy_account };
(globalThis as unknown as { ThreadsPlugin: typeof ThreadsPlugin }).ThreadsPlugin = ThreadsPlugin;
export default ThreadsPlugin;
