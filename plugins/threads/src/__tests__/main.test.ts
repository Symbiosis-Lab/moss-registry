import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { getSecret } from "@symbiosis-lab/moss-api";
vi.mock("@symbiosis-lab/moss-api", () => ({ getSecret: vi.fn(async () => "private-token") }));
import plugin, { publish_copy, find_copy, delete_copy, copy_account, type CopyJob } from "../main";
import manifest from "../../assets/manifest.json";

const page = "https://example.org/note/";
const parts = ["First & <one>", "Second 👨‍👩‍👧", `Third\n\n${page}`].map((text) => ({ text, links: [page] }));
function job(over: Partial<CopyJob> = {}): CopyJob {
  return { op: "publish", channel: "threads", idempotency_key: "stable-key", post: { url: page, source_path: "note.md", title: "" }, form: "short", parts: [parts[2]], config: { api: "http://127.0.0.1:9" }, ...over };
}
interface Options { failAt?: number; status?: number; code?: number; stage?: "create" | "publish" | "lookup"; lost?: boolean; missingId?: boolean; rollback?: "fail" | "false"; readiness?: string[] }
function standIn(o: Options = {}) {
  const posts = new Map<string, any>();
  const containers = new Map<string, any>();
  const calls: { method: string; path: string; body: any }[] = [];
  let next = 100;
  let polls = 0;
  const response = (status: number, data: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url);
    expect(u.origin).toBe("http://127.0.0.1:9");
    expect(init.redirect).toBe("error");
    expect((init.headers as any).authorization).toBe("Bearer private-token");
    const method = init.method!;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const path = u.pathname.replace(/^\/v1\.0/, "");
    calls.push({ method, path, body });
    const stage = path === "/me/threads" && method === "POST" ? "create" : path === "/me/threads_publish" ? "publish" : method === "GET" && posts.has(path.slice(1)) ? "lookup" : "";
    if (stage === (o.stage ?? "publish") && posts.size === o.failAt) {
      if (o.lost) throw new Error("transport private-token");
      return response(o.status ?? 400, { error: { code: o.code, message: "secret private-token" } });
    }
    if (method === "POST" && path === "/me/threads") {
      const id = String(next++); containers.set(id, body); return response(200, { id });
    }
    if (method === "POST" && path === "/me/threads_publish") {
      const c = containers.get(body.creation_id);
      const id = String(next++);
      posts.set(id, { id, text: c.text, is_reply: !!c.reply_to_id, ...(c.reply_to_id ? { replied_to: { id: c.reply_to_id } } : {}), permalink: `https://www.threads.com/@test/post/${id}` });
      return response(200, o.missingId ? {} : { id });
    }
    if (method === "DELETE") {
      if (o.rollback === "fail") return response(503, {});
      if (o.rollback === "false") return response(200, { success: false });
      posts.delete(path.slice(1)); return response(200, { success: true });
    }
    if (path === "/me/threads") return response(200, { data: [...posts.values()] });
    if (path === "/me") return response(200, { id: "7001" });
    if (containers.has(path.slice(1))) {
      const statuses = o.readiness ?? ["FINISHED"];
      return response(200, { status: statuses[Math.min(polls++, statuses.length - 1)] });
    }
    return posts.has(path.slice(1)) ? response(200, posts.get(path.slice(1))) : response(404, {});
  }));
  return { posts, calls, containers };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getSecret).mockResolvedValue("private-token"); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("declares only implemented forms and conservative counting", () => {
  expect(manifest.contributes.channel.syndication).toEqual({ forms: ["short", "thread", "teaser"], max_chars: 500, counting: "utf16" });
  expect(plugin).not.toHaveProperty("update_copy");
});
it.each(["short", "thread", "teaser"] as const)("publishes %s without losing shaped text", async (form) => {
  const net = standIn();
  const shaped = form === "thread" ? parts : [parts[2]];
  const result = await publish_copy(job({ form, parts: shaped, teaser: { title: "Title", description: "Opening", url: page } }));
  expect(result.success).toBe(true);
  expect([...net.posts.values()].map((p) => p.text)).toEqual(shaped.map((p) => p.text));
  const creates = net.calls.filter((c) => c.path === "/me/threads");
  expect(creates.map((c) => c.body.reply_to_id)).toEqual(form === "thread" ? [undefined, "101", "103"] : [undefined]);
  expect(creates[0].body).toEqual({ media_type: "TEXT", text: shaped[0].text, ...(form === "teaser" ? { link_attachment: page } : {}) });
  expect(result.copy?.parts?.length).toBe(shaped.length - 1);
});
it("waits for a FINISHED container before publishing", async () => {
  vi.useFakeTimers(); const net = standIn({ readiness: ["IN_PROGRESS", "FINISHED"] });
  const result = publish_copy(job()); await vi.runAllTimersAsync();
  expect((await result).success).toBe(true);
  expect(net.calls.slice(0, 4).map((c) => c.method)).toEqual(["POST", "GET", "GET", "POST"]);
});
it.each(["IN_PROGRESS", "UNRECOGNIZED", "PUBLISHED", "ERROR", "EXPIRED"])("refuses readiness %s without publication", async (status) => {
  vi.useFakeTimers(); const net = standIn({ readiness: [status] });
  const result = publish_copy(job()); await vi.runAllTimersAsync();
  expect((await result).copy?.refused?.cause).toBe(["ERROR", "EXPIRED"].includes(status) ? "content" : "unknown");
  expect(net.calls.filter((c) => c.method === "GET").length).toBe(status === "IN_PROGRESS" ? 5 : 1);
  expect(net.posts.size).toBe(0);
});
it.each([[401, undefined, "auth"], [403, undefined, "auth"], [400, 190, "auth"], [429, undefined, "rate"], [400, 4, "rate"], [400, 613, "rate"], [400, 100, "content"], [422, undefined, "content"]])("classifies HTTP %s code %s as %s without leaking secrets", async (status, code, cause) => {
  standIn({ failAt: 0, status: status as number, code: code as number });
  const result = await publish_copy(job());
  expect(result.copy?.refused?.cause).toBe(cause);
  expect(JSON.stringify(result)).not.toContain("private-token");
});
it("refuses transport loss before any publication", async () => {
  standIn({ failAt: 0, stage: "create", lost: true });
  expect((await publish_copy(job())).copy?.refused?.cause).toBe("network");
});
it.each(["https://graph.threads.net.evil.test", "http://graph.threads.net", "https://user:private-token@graph.threads.net", "https://graph.threads.net@evil.test", "ftp://graph.threads.net", "https://graph.threads.net/path", "https://graph.threads.net?token=private-token", "http://127.0.0.1.evil.test", "http://127.0.0.1:9@evil.test", "http://localhost:9", "http://[::1]:9"])("guards origin before reading secrets: %s", async (api) => {
  const net = standIn();
  const result = await publish_copy(job({ config: { api } }));
  expect(result.copy?.refused?.cause).toBe("auth");
  expect(getSecret).not.toHaveBeenCalled();
  expect(net.calls).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("private-token");
});
it("refuses missing credentials", async () => {
  const net = standIn(); vi.mocked(getSecret).mockResolvedValue(null);
  expect((await publish_copy(job())).copy?.refused?.cause).toBe("auth"); expect(net.calls).toEqual([]);
});
it("refuses invalid shaped content before creating containers", async () => {
  const net = standIn();
  for (const p of [[], [{ text: "😀".repeat(251), links: [] }], [{ text: " ", links: [] }]]) {
    expect((await publish_copy(job({ parts: p }))).copy?.refused?.cause).toBe("content");
  }
  expect(net.calls).toEqual([]);
});
it("rolls back partial threads in reverse order on explicit refusal", async () => {
  const net = standIn({ failAt: 2 });
  expect((await publish_copy(job({ form: "thread", parts }))).success).toBe(false);
  expect(net.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/103", "/101"]);
  expect(net.posts.size).toBe(0);
});
it.each(["fail", "false"] as const)("throws when rollback is %s", async (rollback) => {
  const net = standIn({ failAt: 2, rollback });
  await expect(publish_copy(job({ form: "thread", parts }))).rejects.toThrow();
  expect(net.posts.size).toBe(2);
});
it.each([0, 1, 2])("throws on uncertain publication at part %s without retry or rollback", async (failAt) => {
  const net = standIn({ failAt, lost: true });
  await expect(publish_copy(job({ form: "thread", parts }))).rejects.toThrow(/uncertain/);
  expect(net.calls.filter((c) => c.path === "/me/threads_publish").length).toBe(failAt + 1);
  expect(net.calls.filter((c) => c.method === "DELETE")).toEqual([]);
});
it("throws on later container transport loss", async () => {
  const net = standIn({ failAt: 1, lost: true, stage: "create" });
  await expect(publish_copy(job({ form: "thread", parts }))).rejects.toThrow(); expect(net.posts.size).toBe(1);
});
it.each([500, 502, 302])("throws on ambiguous publish HTTP %s", async (status) => {
  standIn({ failAt: 0, status }); await expect(publish_copy(job())).rejects.toThrow();
});
it("throws when successful publication returns no id", async () => {
  const net = standIn({ missingId: true }); await expect(publish_copy(job())).rejects.toThrow(/did not return a valid id/); expect(net.posts.size).toBe(1);
});
it("throws even on explicit refusal during post-publication lookup", async () => {
  const net = standIn({ failAt: 1, stage: "lookup", status: 401 });
  await expect(publish_copy(job())).rejects.toThrow(); expect(net.posts.size).toBe(1);
});
it("recovers a complete thread by text and reply chain or recorded IDs", async () => {
  const net = standIn(); const j = job({ form: "thread", parts });
  const result = await publish_copy(j);
  expect(await find_copy({ ...j, op: "find" })).toEqual(result);
  expect(await find_copy({ ...j, op: "find", previous: result.copy as any })).toEqual(result);
  expect(net.posts.size).toBe(3);
});
it.each(["absent", "partial", "duplicate", "edited", "extra", "unknown-parent"])("throws for %s recovery, never reports absent", async (mode) => {
  const net = standIn(); const j = job({ form: "thread", parts }); await publish_copy(j);
  if (mode === "absent") net.posts.clear();
  if (mode === "partial") net.posts.delete("105");
  if (mode === "duplicate") net.posts.set("200", { ...net.posts.get("101"), id: "200" });
  if (mode === "edited") net.posts.get("101").text = "edited";
  if (mode === "extra") net.posts.set("200", { id: "200", replied_to: { id: "105" } });
  if (mode === "unknown-parent") delete net.posts.get("103").replied_to;
  await expect(find_copy({ ...j, op: "find" })).rejects.toThrow();
});
it("deletes a recorded thread in reverse order and requires confirmation", async () => {
  const net = standIn(); const result = await publish_copy(job({ form: "thread", parts }));
  expect(await delete_copy(job({ op: "delete", previous: result.copy as any }))).toEqual({ success: true });
  expect(net.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/105", "/103", "/101"]);
  expect(net.posts.size).toBe(0);
  expect(await delete_copy(job({ previous: null }))).toEqual({ success: true });
});
it("rejects an invalid permalink during recovery", async () => {
  const net = standIn(); await publish_copy(job()); net.posts.get("101").permalink = "https://threads.com.evil.test/post/101";
  await expect(find_copy(job({ op: "find" }))).rejects.toThrow(/permalink/);
});
it("removes earlier parts if a later container explicitly refuses", async () => {
  const net = standIn({ failAt: 1, stage: "create", status: 429 });
  expect((await publish_copy(job({ form: "thread", parts }))).copy?.refused?.cause).toBe("rate");
  expect(net.posts.size).toBe(0);
});
it("does not expose a secret-store error", async () => {
  standIn(); vi.mocked(getSecret).mockRejectedValueOnce(new Error("private-token"));
  const result = await publish_copy(job());
  expect(result.copy?.refused?.cause).toBe("auth"); expect(JSON.stringify(result)).not.toContain("private-token");
});

it("names the signed-in account by its Threads user id, and fails without a token", async () => {
  standIn();
  expect(await copy_account({ channel: "threads", config: job().config })).toEqual({ success: true, copy: { account: "7001" } });
  vi.mocked(getSecret).mockResolvedValue(null);
  expect((await copy_account({ channel: "threads", config: job().config })).success).toBe(false);
});
