/** Transport boundary tests: every HTTP operation is a mock, including multipart. */
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@symbiosis-lab/moss-api", () => ({ httpPost: vi.fn(), httpPostMultipart: vi.fn() }));
vi.mock("../credential", () => ({ authHeaderToken: vi.fn(async () => "token"), markSessionInvalidated: vi.fn() }));
import { httpPost, httpPostMultipart } from "@symbiosis-lab/moss-api";
import { authHeaderToken, markSessionInvalidated } from "../credential";
import { publishArticle, editArticle, deleteMoment, fetchRemoteCopy, uploadAssetByUrl, uploadAssetMultipart, MattersRefusal, MattersAuthError } from "../api";
function response(body: unknown, status = 200) { return { ok: status < 400, status, text: () => JSON.stringify(body) } as any; }
const published = { id: "draft-id", publishState: "published", article: { id: "article-id", shortHash: "hash", slug: "slug", state: "active" } };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(authHeaderToken).mockResolvedValue("token"); });

describe("copy API boundary", () => {
  it("publishes immediately without scheduling and requests the final Article identity", async () => {
    vi.mocked(httpPost).mockResolvedValue(response({ data: { publishArticle: published } }));
    expect(await publishArticle("draft-id")).toEqual(published);
    const request = vi.mocked(httpPost).mock.calls[0][1] as any;
    expect(request.variables).toEqual({ input: { id: "draft-id" } });
    expect(request.query).toContain("article { id shortHash slug state }");
  });
  it("uses editArticle and deleteMoment with the existing global ID", async () => {
    vi.mocked(httpPost).mockResolvedValueOnce(response({ data: { editArticle: published.article } })).mockResolvedValueOnce(response({ data: { deleteMoment: { id: "moment-id", state: "archived" } } }));
    expect(await editArticle({ id: "article-id", title: "New title" })).toEqual(published.article);
    expect(await deleteMoment("moment-id")).toEqual({ id: "moment-id", state: "archived" });
    expect((vi.mocked(httpPost).mock.calls[0][1] as any).variables).toEqual({ input: { id: "article-id", title: "New title" } });
    expect((vi.mocked(httpPost).mock.calls[1][1] as any).variables).toEqual({ input: { id: "moment-id" } });
  });
  it("sends an explicit null cover when removing an article cover", async () => {
    vi.mocked(httpPost).mockResolvedValue(response({ data: { editArticle: published.article } }));
    await editArticle({ id: "article-id", cover: null });
    expect(vi.mocked(httpPost).mock.calls[0][1]).toMatchObject({ variables: { input: { id: "article-id", cover: null } } });
  });
  it("uploads URL and multipart assets against the correct article or draft", async () => {
    const asset = { id: "asset", path: "https://assets.matters.news/x.png" };
    vi.mocked(httpPost).mockResolvedValue(response({ data: { singleFileUpload: asset } }));
    vi.mocked(httpPostMultipart).mockResolvedValue(response({ data: { singleFileUpload: asset } }));
    expect(await uploadAssetByUrl("https://site.test/x.png", "cover", "article-id", "article")).toEqual(asset);
    expect((vi.mocked(httpPost).mock.calls[0][1] as any).variables.input).toEqual({ url: "https://site.test/x.png", type: "cover", entityId: "article-id", entityType: "article" });
    expect(await uploadAssetMultipart("eA==", "x.png", "image/png", "embed", "draft-id")).toEqual(asset);
    const body = vi.mocked(httpPostMultipart).mock.calls[0][1] as any;
    expect(JSON.parse(body.textFields.find((f: any) => f.name === "operations").value).variables.input).toEqual({ type: "embed", entityType: "draft", entityId: "draft-id", file: null });
    expect(body.files[0]).toMatchObject({ contentBase64: "eA==", filename: "x.png" });
  });
  it.each([200, 500])("preserves explicit revision refusal codes on HTTP %s", async (status) => {
    vi.mocked(httpPost).mockResolvedValue(response({ errors: [{ message: "number of revisions reach limit", extensions: { code: "ARTICLE_REVISION_REACH_LIMIT" } }] }, status));
    await expect(editArticle({ id: "a", content: "x" })).rejects.toMatchObject({ name: "MattersRefusal", code: "ARTICLE_REVISION_REACH_LIMIT" });
  });
  it("explicit pre-publication BAD_USER_INPUT is a refusal", async () => {
    vi.mocked(httpPost).mockResolvedValue(response({ data: { publishArticle: null }, errors: [{ message: "title is required", extensions: { code: "BAD_USER_INPUT" } }] }));
    await expect(publishArticle("d")).rejects.toBeInstanceOf(MattersRefusal);
  });
  it.each([undefined, "INTERNAL_SERVER_ERROR", "ACTION_FAILED", "NETWORK_ERROR"])("unknown GraphQL code %s remains uncertainty", async (code) => {
    vi.mocked(httpPost).mockResolvedValue(response({ data: { publishArticle: null }, errors: [{ message: "after write", extensions: { code } }] }));
    const error = await publishArticle("d").catch(e => e);
    expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(MattersRefusal);
  });
  it("mixed known and unknown errors remain uncertainty", async () => {
    vi.mocked(httpPost).mockResolvedValue(response({ errors: [{ message: "input", extensions: { code: "BAD_USER_INPUT" } }, { message: "after write", extensions: { code: "INTERNAL_SERVER_ERROR" } }] }));
    expect(await publishArticle("d").catch(e => e)).not.toBeInstanceOf(MattersRefusal);
  });
  it.each(["BAD_USER_INPUT", "TOKEN_INVALID"])("partial data with %s is never a refusal", async (code) => {
    vi.mocked(httpPost).mockResolvedValue(response({ data: { publishArticle: published }, errors: [{ message: "partial failure", extensions: { code } }] }));
    const error = await publishArticle("d").catch(e => e);
    expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(MattersRefusal); expect(error).not.toBeInstanceOf(MattersAuthError);
    expect(markSessionInvalidated).not.toHaveBeenCalled();
  });
  it("auth-only failures retain the session-expired refusal", async () => {
    vi.mocked(httpPost).mockResolvedValue(response({ errors: [{ message: "expired", extensions: { code: "TOKEN_INVALID" } }] }, 500));
    await expect(publishArticle("d")).rejects.toBeInstanceOf(MattersAuthError);
    expect(markSessionInvalidated).toHaveBeenCalledOnce();
  });
  it("unexpected node types cannot masquerade as missing copies", async () => {
    vi.mocked(httpPost).mockResolvedValue(response({ data: { node: { __typename: "User", id: "u" } } }));
    await expect(fetchRemoteCopy("u")).rejects.toThrow("unexpected copy type");
  });
  it("null nodes mean absent while transport failure still throws", async () => {
    vi.mocked(httpPost).mockResolvedValueOnce(response({ data: { node: null } })).mockRejectedValueOnce(new Error("timeout"));
    expect(await fetchRemoteCopy("a")).toBeNull();
    await expect(fetchRemoteCopy("a")).rejects.toThrow("timeout");
  });
  it.each([400, 408, 429, 502])("HTTP %s without an explicit GraphQL refusal remains uncertain", async (status) => {
    vi.mocked(httpPost).mockResolvedValue(response({ message: "proxy failure" }, status));
    const error = await publishArticle("d").catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(MattersRefusal);
  });
  it("an auth error mixed with an unknown resolver failure remains uncertain", async () => {
    vi.mocked(httpPost).mockResolvedValue(response({ errors: [
      { message: "expired", extensions: { code: "TOKEN_INVALID" } },
      { message: "after write", extensions: { code: "INTERNAL_SERVER_ERROR" } },
    ] }));
    const error = await publishArticle("d").catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(MattersAuthError);
    expect(error).not.toBeInstanceOf(MattersRefusal);
    expect(markSessionInvalidated).not.toHaveBeenCalled();
  });
  it.each([{}, { node: false }, { node: {} }])("malformed lookup %j never proves absence", async (data) => {
    vi.mocked(httpPost).mockResolvedValue(response({ data }));
    await expect(fetchRemoteCopy("a")).rejects.toThrow();
  });

});
