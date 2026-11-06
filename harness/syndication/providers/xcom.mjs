// X: a local stand-in for the v2 posting API, written from X's API reference
// (X has no test environment, and every real post is billed). It checks each
// request's OAuth 1.0a signature with Node's own HMAC, refuses a post over
// 280 weighted characters or a reply to a post it does not hold, and answers
// with the documented bodies, links shortened as X shortens them.

import crypto from "node:crypto";
import http from "node:http";

const creds = { api_key: "harness-consumer", api_key_secret: "harness consumer secret", access_token: "1-harness-token", access_token_secret: "harness token secret" };
const percent = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function signed(req, url) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("OAuth ")) return false;
  const oauth = Object.fromEntries([...header.slice(6).matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, decodeURIComponent(v)]));
  if (oauth.oauth_consumer_key !== creds.api_key || oauth.oauth_token !== creds.access_token) return false;
  const params = [...url.searchParams, ...Object.entries(oauth).filter(([k]) => k !== "oauth_signature")]
    .map(([k, v]) => [percent(k), percent(v)])
    .sort((a, b) => (a[0] + "\0" + a[1] < b[0] + "\0" + b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`);
  const base = `${req.method}&${percent(`http://${req.headers.host}${url.pathname}`)}&${percent(params.join("&"))}`;
  const want = crypto.createHmac("sha1", `${percent(creds.api_key_secret)}&${percent(creds.access_token_secret)}`).update(base).digest("base64");
  return oauth.oauth_signature === want;
}

/** X's weighting: links 23, Latin and its punctuation 1 (the ranges moss's weighted counting names), everything else 2. */
const light = /[\u0000-\u10ff\u2000-\u200d\u2010-\u201f\u2032-\u2037]/u;
const weighted = (text) => text.split(/(\s+)/).reduce((n, w) => n + (/^https?:\/\//.test(w) ? 23 : [...w].reduce((m, c) => m + (light.test(c) ? 1 : 2), 0)), 0);
/** A post as X shows it: `& < >` escaped and every link replaced with its own short one. */
const shown = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/https?:\/\/\S+/g, () => `https://t.co/${crypto.randomBytes(5).toString("hex")}`);

export async function start() {
  const posts = new Map();
  let next = 1850000000000000000n;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(data === undefined ? "" : JSON.stringify(data));
    };
    const problem = (status, title, detail, type = "about:blank") => send(status, { title, detail, type, status });
    if (!signed(req, url)) return problem(401, "Unauthorized", "Unauthorized");
    if (req.method === "POST" && url.pathname === "/2/tweets") {
      const { text, reply } = JSON.parse(body || "{}");
      if (typeof text !== "string" || weighted(text) > 280) return problem(400, "Invalid Request", "Post text is too long.", "https://api.x.com/2/problems/invalid-request");
      if ([...posts.values()].some((p) => p.text === text)) return problem(403, "Forbidden", "You are not allowed to create a Tweet with duplicate content.");
      if (reply && !posts.has(reply.in_reply_to_tweet_id)) return problem(400, "Invalid Request", "The post being replied to does not exist.", "https://api.x.com/2/problems/invalid-request");
      const id = String(next++);
      posts.set(id, { id, text, shown: shown(text), reply: reply?.in_reply_to_tweet_id });
      return send(201, { data: { id, text: posts.get(id).shown, edit_history_tweet_ids: [id] } });
    }
    const del = url.pathname.match(/^\/2\/tweets\/(\d+)$/);
    if (req.method === "DELETE" && del) {
      if (!posts.delete(del[1])) return problem(404, "Not Found Error", "Could not find post.", "https://api.x.com/2/problems/resource-not-found");
      return send(200, { data: { deleted: true } });
    }
    if (url.pathname === "/2/users/me") return send(200, { data: { id: "42", name: "Alex", username: "alex" } });
    if (url.pathname === "/2/users/42/tweets") {
      const refs = (url.searchParams.get("tweet.fields") ?? "").includes("referenced_tweets");
      const own = [...posts.values()].reverse();
      return send(200, { data: own.map((p) => ({ id: p.id, text: p.shown, ...(refs && p.reply ? { referenced_tweets: [{ type: "replied_to", id: p.reply }] } : {}) })), meta: { result_count: own.length } });
    }
    problem(404, "Not Found Error", `${req.method} ${url.pathname}`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    config: { api: base },
    secrets: creds,
    owns: (page) => /syndicated:[\s\S]*https:\/\/x\.com\/i\/status\/\d+/.test(page),
    count: async () => posts.size,
    async verify(copies, check) {
      const all = [...posts.values()];
      for (const copy of copies) {
        const texts = copy.parts.map((p) => p.text);
        const first = all.find((p) => p.text === texts[0] && !p.reply);
        check(Boolean(first), `${copy.source_path}: a ${copy.form} post with the planned text is on the account`);
        if (!first) continue;
        let parent = first;
        for (const text of texts.slice(1)) {
          const next = all.find((p) => p.text === text && p.reply === parent.id);
          check(Boolean(next), `${copy.source_path}: "${text}" replies to the part before it`);
          if (next) parent = next;
        }
        // X makes the card from a link in the text.
        if (copy.form === "teaser") check(Boolean(copy.link_card) && first.text.includes(copy.link_card.url), `${copy.source_path}: the teaser carries the original's address, for X's card`);
      }
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
