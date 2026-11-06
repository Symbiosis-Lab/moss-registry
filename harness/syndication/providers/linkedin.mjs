// LinkedIn: a local stand-in for the Posts API, written from LinkedIn's API
// reference (LinkedIn has no test environment; its development tier posts to
// the live network). It requires the version and protocol headers, posts only
// as the token's own member, reads commentary as little text and refuses an
// unescaped reserved character, and holds 3,000 characters as the limit.

import http from "node:http";

const TOKEN = "harness-linkedin-token";
const MEMBER = "782bbtaQ";

/** Little text back to what was meant; null when a reserved character is unescaped, which LinkedIn would read as markup. */
function unescape(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") out += s[++i] ?? "";
    else if ("|{}@[]()<>#*_~".includes(s[i])) return null;
    else out += s[i];
  }
  return out;
}

export async function start() {
  const posts = new Map();
  let next = 7400000000000000000n;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = (status, data, headers = {}) => {
      res.writeHead(status, { ...(data === undefined ? {} : { "content-type": "application/json" }), ...headers });
      res.end(data === undefined ? "" : JSON.stringify(data));
    };
    const error = (status, message) => send(status, { status, message });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return error(401, "Invalid access token");
    if (url.pathname === "/v2/userinfo") return send(200, { sub: MEMBER, name: "Alex Example" });
    if (!/^\d{6}$/.test(req.headers["linkedin-version"] ?? "")) return error(400, "Linkedin-Version header is missing or malformed");
    if (req.headers["x-restli-protocol-version"] !== "2.0.0") return error(400, "X-Restli-Protocol-Version 2.0.0 is required");
    const method = req.headers["x-restli-method"] ?? req.method;
    if (/^\/rest\/posts\/.*:/.test(url.pathname)) return error(400, "INVALID_URN_TYPE: a URN in the path must be encoded");
    const urn = decodeURIComponent(url.pathname.replace(/^\/rest\/posts\/?/, ""));
    const commentary = (c) => {
      const text = unescape(c ?? "");
      if (text === null) return [null, error(422, "commentary has an unescaped reserved character")];
      if (text.length > 3000) return [null, error(400, "FIELD_LENGTH_TOO_LONG: commentary")];
      return [text];
    };
    if (url.pathname === "/rest/posts" && req.method === "POST") {
      const post = JSON.parse(body || "{}");
      if (post.author !== `urn:li:person:${MEMBER}`) return error(403, "ACCESS_DENIED: not the member's own author");
      const [text] = commentary(post.commentary);
      if (text === null) return;
      const id = `urn:li:share:${next++}`;
      posts.set(id, { ...post, text });
      return send(201, undefined, { "x-restli-id": id });
    }
    if (urn && method === "PARTIAL_UPDATE") {
      if (!posts.has(urn)) return error(404, "NOT_FOUND");
      const [text] = commentary(JSON.parse(body || "{}").patch?.$set?.commentary);
      if (text === null) return;
      posts.get(urn).text = text;
      return send(204);
    }
    if (urn && method === "DELETE") {
      posts.delete(urn);
      return send(204);
    }
    error(404, "NOT_FOUND");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    config: { api: `http://127.0.0.1:${server.address().port}` },
    secrets: { access_token: TOKEN },
    owns: (page) => /syndicated:[\s\S]*https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:share:\d+\//.test(page),
    count: async () => posts.size,
    async verify(copies, check) {
      const all = [...posts.values()];
      for (const copy of copies) {
        const text = copy.parts.map((p) => p.text).join("\n\n");
        const post = all.find((p) => p.text === text);
        check(Boolean(post), `${copy.source_path}: a ${copy.form} post with the planned text is on the profile`);
        if (!post) continue;
        check(post.visibility === "PUBLIC" && post.lifecycleState === "PUBLISHED", `${copy.source_path}: the copy is public and published`);
        if (copy.form === "teaser") check(post.content?.article?.source === copy.link_card?.url && post.content.article.title === copy.link_card.title, `${copy.source_path}: the teaser carries an article card for the original`);
      }
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
