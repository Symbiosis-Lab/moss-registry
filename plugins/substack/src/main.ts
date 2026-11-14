/**
 * Substack channel. Substack has no API for posting, so an article goes
 * through its own editor: moss shapes the article, the panel shows it with a
 * button that copies it and opens the editor, and the author pastes and
 * publishes. The copy is found afterwards in the publication's feed, by its
 * link back to the original.
 */

import { onEvent, openBrowser, openBrowserWithHtml, startTask } from "@symbiosis-lab/moss-api";
import { handoffResult, writeArticle, type Article } from "../../article-handoff";

export interface CopyJob {
  op: "publish" | "update" | "delete" | "find";
  channel: string;
  post: { url: string; title: string };
  form?: "long";
  article?: Article | null;
  config: Record<string, unknown>;
}

export interface CopyResult {
  success: boolean;
  message?: string;
  copy?: {
    id?: string;
    url?: string;
    refused?: { cause: "auth" | "content" | "rate" | "network" | "unknown"; message?: string };
    handoff?: { text: string; open_url?: string };
  } | null;
}

const unset = (message: string): CopyResult => ({ success: false, message, copy: { refused: { cause: "auth", message } } });

/** The publication's editor, or why there is none to open. */
function editor(job: CopyJob): string | CopyResult {
  const address = String(job.config.publication ?? "").trim();
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return unset("set your Substack's address first");
  }
  return url.protocol === "https:" ? `${url.origin}/publish/post` : unset(`your Substack's address must start with https://, not ${address}`);
}

export async function publish_copy(job: CopyJob): Promise<CopyResult> {
  const url = editor(job);
  return typeof url === "string" ? writeArticle({ openBrowser, openBrowserWithHtml, onEvent, startTask }, job.article, { name: "Substack", url }) : url;
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * The published post whose body links back to the page. A feed that does not
 * list it says only that it is not among the latest posts, so the copy keeps
 * waiting; a feed that cannot be read says nothing, and that is thrown.
 */
export async function find_copy(job: CopyJob): Promise<CopyResult> {
  const url = editor(job);
  if (typeof url !== "string") return url;
  const home = new URL(url).origin;
  const r = await fetch(`${home}/feed`);
  if (!r.ok) throw new Error(`${home}/feed answered ${r.status}`);
  const feed = await r.text();
  if (!/<rss[\s>]/.test(feed)) throw new Error(`${home}/feed is not a feed`);
  const page = job.post.url.replace(/\/+$/, "");
  // Newest first in a feed: the copy is the oldest post that links back, and a later one only mentions it.
  let found: CopyResult = handoffResult(url);
  for (const [, item] of feed.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = decode(item.replace(/<!\[CDATA\[|\]\]>/g, ""));
    const linked = [...body.matchAll(/href="([^"]+)"/g)].some(([, href]) => href.replace(/\/+$/, "") === page);
    const link = /<link>([^<]+)<\/link>/.exec(item)?.[1].trim();
    if (linked && link) found = { success: true, copy: { id: link, url: link } };
  }
  return found;
}

const SubstackPlugin = { publish_copy, find_copy };
(globalThis as unknown as { SubstackPlugin: typeof SubstackPlugin }).SubstackPlugin = SubstackPlugin;
export default SubstackPlugin;
