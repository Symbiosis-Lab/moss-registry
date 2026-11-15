/** Matters' copy lifecycle. A stored attempt survives a lost mutation response. */
import type { CopyJob, CopyOutcome } from "@symbiosis-lab/moss-api";
import { pluginFileExists, readPluginFile, writePluginFile } from "@symbiosis-lab/moss-api";
import { sha256, toUtf8Bytes } from "ethers";
import type { HookResult, MattersDraftWithArticle, PutDraftInput } from "./types";
import {
  createDraft, fetchDraft, fetchAllArticles, fetchRemoteCopy, publishArticle, editArticle,
  deleteMoment, putMoment, fetchUserProfile, MattersAuthError, MattersRefusal,
  type PublishedArticle, type RemoteCopy,
} from "./api";
import { clearTokenCache, getSessionState } from "./credential";
import { initializeDomain, getDomain, articleUrl, momentUrl } from "./domain";
import { getConfig } from "./config";
import { setCurrentHookName, sleep } from "./utils";
import {
  stripArticleTitleH1, normalizeHtmlForMatters, absolutizeRelativeHrefs, wrapAudioForMatters,
  uploadAndReplaceLocalImages, uploadAndReplaceLocalAudio, uploadPicture, PictureFailure,
} from "./content";

type Cause = NonNullable<CopyOutcome["refused"]>["cause"];
type Attempt =
  | { phase: "creating" | "absent" }
  | { phase: "prepared" | "publishing"; draftId: string }
  | { phase: "published"; draftId: string; articleId: string };
const SIGN_IN = "connect Matters first: sign in from the plugin's settings";
const CONFIRM_ATTEMPTS = 6;

function refusal(cause: Cause, message: string): HookResult {
  return { success: false, message, copy: { refused: { cause, message } } };
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function refusedOrThrow(error: unknown): HookResult {
  if (error instanceof PictureFailure) return refusal(error.cause, error.message);
  if (error instanceof MattersAuthError) return refusal("auth", "the Matters session expired; sign in again");
  if (error instanceof MattersRefusal) {
    return refusal(error.status === 429 || error.code === "ACTION_LIMIT_EXCEEDED" ? "rate" : "content", error.message);
  }
  throw error;
}
async function initialize(hook: string): Promise<HookResult | undefined> {
  setCurrentHookName(hook);
  clearTokenCache();
  try { await initializeDomain(); } catch (error) { return refusal("network", errorText(error)); }
  if ((await getSessionState()) !== "valid") return refusal("auth", SIGN_IN);
  return undefined;
}
async function viewerName(): Promise<string> {
  return (await getConfig()).userName ?? (await fetchUserProfile()).userName;
}
async function attemptFile(job: CopyJob): Promise<string> {
  const identity = [getDomain(), await viewerName(), job.idempotency_key];
  return `copy-${sha256(toUtf8Bytes(JSON.stringify(identity)))}.json`;
}
async function readAttempt(file: string): Promise<Attempt | undefined> {
  if (!(await pluginFileExists(file))) return undefined;
  // Storage errors must not look like a first send.
  const value: unknown = JSON.parse(await readPluginFile(file));
  if (value && typeof value === "object" && "phase" in value) {
    const draftId = "draftId" in value ? value.draftId : undefined;
    const articleId = "articleId" in value ? value.articleId : undefined;
    switch (value.phase) {
      case "creating":
      case "absent":
        if (draftId === undefined && articleId === undefined) return { phase: value.phase };
        break;
      case "prepared":
      case "publishing":
        if (typeof draftId === "string" && draftId.trim() && articleId === undefined) {
          return { phase: value.phase, draftId };
        }
        break;
      case "published":
        if (typeof draftId === "string" && draftId.trim() && typeof articleId === "string" && articleId.trim()) {
          return { phase: value.phase, draftId, articleId };
        }
    }
  }
  throw new Error("Matters copy recovery record is invalid");
}
async function saveAttempt(file: string, attempt: Attempt): Promise<void> {
  await writePluginFile(file, JSON.stringify(attempt));
}
function copyOf(article: { id: string; shortHash: string; slug: string }, user: string): { id: string; url: string } {
  if (!article.id || !article.shortHash || !article.slug) throw new Error("Matters has not confirmed the article's ID and address");
  return { id: article.id, url: articleUrl(user, article.slug, article.shortHash) };
}
function published(draft: MattersDraftWithArticle | null | undefined): boolean {
  return draft?.publishState === "published" && draft.article?.state === "active";
}
async function confirmed(draftId: string, initial?: MattersDraftWithArticle): Promise<MattersDraftWithArticle> {
  let draft = initial;
  for (let poll = 0; poll < CONFIRM_ATTEMPTS; poll++) {
    if (published(draft)) return draft!;
    if (poll > 0) await sleep(1000);
    draft = (await fetchDraft(draftId)) ?? undefined;
  }
  if (published(draft)) return draft!;
  throw new Error(`Matters publication of draft ${draftId} is unconfirmed; check again before sending another copy`);
}
async function rememberPublished(file: string, draft: MattersDraftWithArticle): Promise<HookResult> {
  const copy = copyOf(draft.article!, await viewerName());
  await saveAttempt(file, { phase: "published", draftId: draft.id, articleId: copy.id });
  return { success: true, copy };
}

/** Post directly; only a confirmed published Article is a successful long copy. */
export async function publish_copy(job: CopyJob): Promise<HookResult> {
  const blocked = await initialize("publish_copy");
  if (blocked) return blocked;
  if ((job.form === "short" || job.form === "teaser") && job.parts?.[0]) {
    try {
      const moment = await putMoment(momentHtml(job.parts[0].text, job.parts[0].links));
      if (!moment.id || !moment.shortHash) throw new Error("Matters has not confirmed the moment's ID and address");
      return { success: true, copy: { id: moment.id, url: momentUrl(moment.shortHash) } };
    } catch (error) { return refusedOrThrow(error); }
  }
  if (job.form !== "long" || !job.article?.html.trim()) return refusal("content", "Matters takes a moment or an article with a body");
  const file = await attemptFile(job);
  const attempt = await readAttempt(file);
  // A repeat publish is a lookup, never another article. No title/backlink heuristic is needed.
  if (job.previous?.id || attempt?.phase === "published") {
    const found = await find_copy(job);
    if (!found.success || !found.copy?.id || !found.copy.url) throw new Error(found.message || "Matters publication is unconfirmed");
    return found;
  }
  if (attempt?.phase === "creating") throw new Error("Matters draft creation is unconfirmed; a second draft would risk a duplicate");
  if (attempt?.phase === "publishing") {
    return rememberPublished(file, await confirmed(attempt.draftId));
  }

  let draft: MattersDraftWithArticle;
  if (attempt?.phase === "prepared") {
    const existing = await fetchDraft(attempt.draftId);
    if (!existing) throw new Error("The recorded Matters draft is missing; publication cannot be ruled out");
    if (published(existing)) return rememberPublished(file, existing);
    if (existing.publishState !== "unpublished") throw new Error("The Matters draft is not ready for another publish attempt");
    draft = existing;
  } else {
    await saveAttempt(file, { phase: "creating" });
    try { draft = await createDraft({ title: job.article.title }); }
    catch (error) {
      if (error instanceof MattersRefusal || error instanceof MattersAuthError) await saveAttempt(file, { phase: "absent" });
      return refusedOrThrow(error);
    }
    if (!draft?.id) throw new Error("Matters did not return a draft ID");
    await saveAttempt(file, { phase: "prepared", draftId: draft.id });
  }
  try {
    const input = await articleInput(job, draft.id, "draft");
    await createDraft({ ...input, id: draft.id });
  } catch (error) { return refusedOrThrow(error); }

  await saveAttempt(file, { phase: "publishing", draftId: draft.id });
  let response: MattersDraftWithArticle;
  try { response = await publishArticle(draft.id); }
  catch (error) {
    // Only explicit pre-publication rejection permits retry. Unknown GraphQL/transport failures stay publishing.
    if (error instanceof MattersRefusal || error instanceof MattersAuthError) {
      await saveAttempt(file, { phase: "prepared", draftId: draft.id });
      return refusedOrThrow(error);
    }
    throw error;
  }
  return rememberPublished(file, await confirmed(draft.id, response));
}

async function articleInput(job: CopyJob, id: string, entityType: "draft" | "article"): Promise<PutDraftInput> {
  const article = job.article!;
  let content = normalizeHtmlForMatters(stripArticleTitleH1(article.html, article.title));
  content = wrapAudioForMatters(absolutizeRelativeHrefs(content, job.post.url), job.post.url);
  content = await uploadAndReplaceLocalImages(content, job.post.url, id, entityType);
  content = await uploadAndReplaceLocalAudio(content, job.post.url, id, entityType);
  const cover = article.cover ? await uploadPicture(article.cover, job.post.url, id, "cover", entityType) : undefined;
  return { title: article.title, content, summary: article.description ?? "", tags: job.post.tags ?? [], cover: cover?.id ?? null };
}

/** Resolve older short-hash receipts as well as current global IDs. */
async function previousNode(job: CopyJob): Promise<RemoteCopy | null> {
  const id = job.previous?.id;
  if (!id) throw new Error("The Matters copy ID is missing");
  // v1.6 published receipts stored shortHash; their URL includes that hash.
  if (job.previous?.url && !job.previous.url.includes("/m/") && (job.previous.url.endsWith(`/a/${id}`) || job.previous.url.endsWith(`-${id}`))) {
    const { articles } = await fetchAllArticles();
    const article = articles.find((a) => a.shortHash === id);
    if (!article) throw new Error("Cannot resolve the older Matters copy ID");
    return fetchRemoteCopy(article.id);
  }
  return fetchRemoteCopy(id);
}
async function nodeResult(node: RemoteCopy | null): Promise<HookResult> {
  if (!node) return { success: true, copy: null };
  if (node.__typename === "Draft") {
    if (!published(node)) throw new Error("Matters draft publication is unconfirmed");
    return { success: true, copy: copyOf(node.article!, await viewerName()) };
  }
  if (node.state === "archived") return { success: true, copy: null };
  if (node.state !== "active") throw new Error(`Matters copy is ${node.state}; publication is unconfirmed`);
  if (node.__typename === "Moment") {
    if (!node.id || !node.shortHash) throw new Error("Matters moment identity is unconfirmed");
    return { success: true, copy: { id: node.id, url: momentUrl(node.shortHash) } };
  }
  return { success: true, copy: copyOf(node, await viewerName()) };
}

export async function find_copy(job: CopyJob): Promise<HookResult> {
  try {
    const blocked = await initialize("find_copy");
    if (blocked) return blocked;
    if (job.previous?.id) return await nodeResult(await previousNode(job));
    const file = await attemptFile(job);
    const attempt = await readAttempt(file);
    if (attempt?.phase === "absent") return { success: true, copy: null };
    if (attempt?.phase === "published") return await nodeResult(await fetchRemoteCopy(attempt.articleId));
    if (attempt?.phase === "prepared" || attempt?.phase === "publishing") {
      const draft = await fetchDraft(attempt.draftId);
      if (published(draft)) return await rememberPublished(file, draft!);
      if (attempt.phase === "prepared" && draft?.publishState === "unpublished") return { success: true, copy: null };
      throw new Error("Matters publication is unconfirmed; recovery must check this draft again");
    }
    if (attempt) throw new Error("Matters draft creation is unconfirmed");
    // Legacy recovery only: a backlink can identify an old published copy, never prove absence.
    if (job.form === "long" && job.article) {
      const { articles, userName } = await fetchAllArticles();
      const matches = articles.filter((a) => a.title === job.article!.title && a.content.includes(job.post.url));
      if (matches.length === 1) return { success: true, copy: copyOf(matches[0], userName) };
    }
    throw new Error("No Matters recovery record; cannot establish whether a copy was published");
  } catch (error) { return { success: false, message: errorText(error) }; }
}

export async function update_copy(job: CopyJob): Promise<HookResult> {
  const blocked = await initialize("update_copy");
  if (blocked) return blocked;
  try {
    const node = await previousNode(job);
    if (node?.__typename !== "Article" || job.form !== "long" || !job.article?.html.trim()) {
      return refusal("content", "Only an existing Matters article can be revised; moments cannot be edited");
    }
    const input = await articleInput(job, node.id, "article");
    const article: PublishedArticle = await editArticle({ ...input, id: node.id });
    if (article.id !== node.id || article.state !== "active") throw new Error("Matters has not confirmed the article revision");
    return { success: true, copy: copyOf(article, await viewerName()) };
  } catch (error) {
    if (error instanceof MattersRefusal && error.code === "ARTICLE_REVISION_REACH_LIMIT") {
      return refusal("content", "This Matters copy can no longer be revised: Matters' revision limit has been reached");
    }
    return refusedOrThrow(error);
  }
}

export async function delete_copy(job: CopyJob): Promise<HookResult> {
  const blocked = await initialize("delete_copy");
  if (blocked) return blocked;
  try {
    const node = await previousNode(job);
    let message = "Matters copy deleted";
    if (node?.__typename === "Moment") {
      const deleted = await deleteMoment(node.id);
      if (deleted.id !== node.id || deleted.state !== "archived") throw new Error("Matters has not confirmed the moment deletion");
    } else if (node?.__typename === "Article") {
      if (node.state !== "archived") {
        const archived = await editArticle({ id: node.id, state: "archived" });
        if (archived.id !== node.id || archived.state !== "archived") throw new Error("Matters has not confirmed the article archive");
      }
      message = "Matters copy archived. Matters retains the archive; this is not permanent erasure";
    } else if (node) {
      return refusal("content", "The Matters copy is still a draft; its publication must be resolved first");
    }
    await saveAttempt(await attemptFile(job), { phase: "absent" });
    return { success: true, copy: null, message };
  } catch (error) { return refusedOrThrow(error); }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function momentHtml(text: string, links: string[]): string {
  let html = "";
  let from = 0;
  for (const link of links) {
    const at = text.indexOf(link, from);
    if (at < 0) continue;
    html += escapeHtml(text.slice(from, at)) + `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`;
    from = at + link.length;
  }
  html += escapeHtml(text.slice(from));
  return html.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}
