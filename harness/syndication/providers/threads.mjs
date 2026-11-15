// In-process Threads API stand-in. Status timing and reply fields remain provisional until a live account run.
import http from "node:http";

const token = "threads-loopback-token";
export async function start() {
  const containers = new Map();
  const posts = new Map();
  let next = 1000;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: { code: 190 } });
    let body;
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      body = JSON.parse(raw || "{}");
    } catch { return send(400, { error: { code: 100 } }); }
    if (req.method === "POST" && url.pathname === "/v1.0/me/threads") {
      if (body.media_type !== "TEXT" || typeof body.text !== "string" || !body.text.trim() || body.text.length > 500
        || (body.reply_to_id && !posts.has(body.reply_to_id))
        || Object.keys(body).some((k) => !["media_type", "text", "reply_to_id", "link_attachment"].includes(k))) {
        return send(400, { error: { code: 100 } });
      }
      const id = String(next++);
      containers.set(id, { ...body, checked: false, published: false });
      return send(200, { id });
    }
    if (req.method === "POST" && url.pathname === "/v1.0/me/threads_publish") {
      const c = containers.get(body.creation_id);
      if (!c || !c.checked || c.published) return send(400, { error: { code: 100 } });
      c.published = true;
      const id = String(next++);
      posts.set(id, { id, text: c.text, permalink: `https://www.threads.com/@tester/post/${id}`, is_reply: !!c.reply_to_id,
        ...(c.reply_to_id ? { replied_to: { id: c.reply_to_id } } : {}), link_attachment: c.link_attachment });
      return send(200, { id });
    }
    if (req.method === "GET" && url.pathname === "/v1.0/me/threads") {
      return send(200, { data: [...posts.values()].reverse().slice(0, 100) });
    }
    const match = url.pathname.match(/^\/v1\.0\/(\d+)$/);
    if (match) {
      const id = match[1];
      if (req.method === "DELETE") {
        if (!posts.delete(id)) return send(400, { error: { code: 100 } });
        return send(200, { success: true });
      }
      if (req.method === "GET") {
        if (containers.has(id)) { containers.get(id).checked = true; return send(200, { id, status: "FINISHED" }); }
        if (posts.has(id)) return send(200, posts.get(id));
      }
    }
    send(404, { error: { code: 100 } });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const api = `http://127.0.0.1:${server.address().port}`;
  async function read(path) {
    const res = await fetch(`${api}/v1.0${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Threads stand-in read failed: ${res.status}`);
    return res.json();
  }
  return {
    config: { api }, secrets: { access_token: token }, edits: false, recovers: "ask",
    owns: (page) => /syndicated:[\s\S]*https:\/\/www\.threads\.com\/@tester\/post\/\d+/.test(page),
    count: async () => (await read("/me/threads")).data.length,
    async verify(copies, check) {
      const all = (await read("/me/threads")).data;
      check(all.length === copies.reduce((n, c) => n + c.parts.length, 0), "Threads holds exactly the planned number of parts");
      for (const c of copies) {
        let parent;
        for (const part of c.parts) {
          const matches = all.filter((p) => p.text === part.text && p.replied_to?.id === parent && p.is_reply === !!parent);
          check(matches.length === 1, `${c.source_path}: exactly one part has the planned text and reply parent`);
          if (matches.length !== 1) break;
          const post = await read(`/${matches[0].id}`);
          check(post.text === part.text, `${c.source_path}: lookup preserves all text and backlinks`);
          if (c.form === "teaser") check(post.link_attachment === c.link_card?.url, `${c.source_path}: teaser attaches the original's address`);
          parent = post.id;
        }
      }
    },
    stop: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}
