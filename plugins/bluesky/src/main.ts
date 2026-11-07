/**
 * Bluesky channel: posts one copy per call, as moss's syndication contract
 * asks. moss decides what is due and shapes the text; this turns a job into
 * `app.bsky.feed.post` records on the author's own account.
 */

import { getSecret } from "@symbiosis-lab/moss-api";
import { createSession, deletePost, getPost, putPost, recordKey, rkeyOf, XrpcError, type Session, type StrongRef } from "./atproto";

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

/** Link facets, which Bluesky needs to make an address clickable: byte offsets in UTF-8. */
export function linkFacets(text: string, links: string[]): unknown[] {
  const bytes = new TextEncoder();
  const facets: unknown[] = [];
  let from = 0;
  for (const uri of links) {
    const at = text.indexOf(uri, from);
    if (at < 0) continue;
    const byteStart = bytes.encode(text.slice(0, at)).length;
    facets.push({
      index: { byteStart, byteEnd: byteStart + bytes.encode(uri).length },
      features: [{ $type: "app.bsky.richtext.facet#link", uri }],
    });
    from = at + uri.length;
  }
  return facets;
}

async function session(job: CopyJob): Promise<Session> {
  const handle = String(job.config.handle ?? "");
  const service = String(job.config.service || "https://bsky.social");
  const password = await getSecret("app_password");
  if (!handle || !password) throw new XrpcError(401, "NoCredentials", "connect Bluesky first: a handle and an app password");
  return createSession(service, handle, password);
}

function postUrl(s: Session, ref: StrongRef): string {
  return `https://bsky.app/profile/${s.handle}/post/${rkeyOf(ref.uri)}`;
}

function refused(e: unknown): CopyResult {
  if (e instanceof XrpcError) {
    const cause: Cause = e.status === 401 || e.status === 403 ? "auth" : e.status === 429 ? "rate" : e.status === 400 ? "content" : "network";
    return { success: false, message: e.message, copy: { refused: { cause, message: e.message } } };
  }
  throw e;
}

export async function publish_copy(job: CopyJob): Promise<CopyResult> {
  let s: Session;
  try {
    s = await session(job);
  } catch (e) {
    return refused(e);
  }
  const parts = job.parts ?? [];
  const refs: StrongRef[] = [];
  try {
    for (let i = 0; i < parts.length; i++) {
      const record: Record<string, unknown> = {
        $type: "app.bsky.feed.post",
        text: parts[i].text,
        createdAt: new Date().toISOString(),
        facets: linkFacets(parts[i].text, parts[i].links),
      };
      if (job.post.lang) record.langs = [job.post.lang];
      if (i > 0) record.reply = { root: refs[0], parent: refs[i - 1] };
      if (job.form === "teaser" && job.teaser) {
        record.embed = { $type: "app.bsky.embed.external", external: { uri: job.teaser.url, title: job.teaser.title, description: job.teaser.description } };
      }
      refs.push(await putPost(s, recordKey(job.idempotency_key, job.post.date ?? undefined, i), record));
    }
  } catch (e) {
    // A thread that stopped part way is retried whole: the parts already sent
    // keep their record keys and are found again, not posted twice.
    return refused(e);
  }
  const [first, ...rest] = refs;
  return {
    success: true,
    copy: { id: first.uri, url: postUrl(s, first), parts: rest.map((r) => ({ id: r.uri, url: postUrl(s, r) })) },
  };
}

export async function find_copy(job: CopyJob): Promise<CopyResult> {
  try {
    const s = await session(job);
    const first = await getPost(s, recordKey(job.idempotency_key, job.post.date ?? undefined, 0));
    if (!first) return { success: true, copy: null };
    return { success: true, copy: { id: first.uri, url: postUrl(s, first) } };
  } catch (e) {
    return refused(e);
  }
}

export async function delete_copy(job: CopyJob): Promise<CopyResult> {
  try {
    const s = await session(job);
    const previous = job.previous;
    if (!previous) return { success: true };
    for (const part of [...(previous.parts ?? [])].reverse()) await deletePost(s, rkeyOf(part.id));
    await deletePost(s, rkeyOf(previous.id));
    return { success: true };
  } catch (e) {
    return refused(e);
  }
}

// Bluesky cannot edit a post once made, so there is no update_copy: moss
// reports such a copy as one that cannot be edited.
const BlueskyPlugin = { publish_copy, find_copy, delete_copy };
(globalThis as unknown as { BlueskyPlugin: typeof BlueskyPlugin }).BlueskyPlugin = BlueskyPlugin;
export default BlueskyPlugin;
