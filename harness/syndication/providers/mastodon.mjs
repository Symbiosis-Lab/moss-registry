// Mastodon: a GoToSocial server in Docker, which speaks the Mastodon client
// API. Two accounts: the author, who signs in through the server's own OAuth
// pages as a real author's app would, and a reader who follows the author and
// must see each copy on their home timeline.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const IMAGE = "superseriousbusiness/gotosocial:0.20.2";
const PASSWORD = "Harness-pass-1234";
const CONFIG = "/gotosocial/storage/config.yaml";

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Signs `user` in through the server's OAuth pages and returns an access token. */
async function token(base, user) {
  const jar = new Map();
  const req = async (p, init = {}) => {
    const r = await fetch(new URL(p, base), { ...init, redirect: "manual", headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    return r;
  };
  const form = { "content-type": "application/x-www-form-urlencoded" };
  const oob = "urn:ietf:wg:oauth:2.0:oob";
  const app = await (await req("/api/v1/apps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "moss", redirect_uris: oob, scopes: "read write" }) })).json();
  await req(`/oauth/authorize?client_id=${app.client_id}&redirect_uri=${encodeURIComponent(oob)}&response_type=code&scope=read+write`);
  const signedIn = await req("/auth/sign_in", { method: "POST", headers: form, body: `username=${user}%40example.org&password=${PASSWORD}` });
  if (signedIn.status !== 302) throw new Error(`signing ${user} in: ${signedIn.status}`);
  await req("/oauth/authorize");
  const allowed = await req("/oauth/authorize", { method: "POST", headers: form, body: "" });
  const code = new URL(allowed.headers.get("location") ?? "", base).searchParams.get("code");
  if (!code) throw new Error(`authorizing ${user}: no code (${allowed.status})`);
  const t = await (await fetch(new URL("/oauth/token", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code, client_id: app.client_id, client_secret: app.client_secret, redirect_uri: oob }) })).json();
  if (!t.access_token) throw new Error(`token for ${user}: ${JSON.stringify(t)}`);
  return t.access_token;
}

/** A status's text as posted, from the HTML the server renders. */
const plain = (html) =>
  html.replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (whole, href, inner) => (/^[#@]/.test(inner.replace(/<[^>]+>/g, "")) ? whole : href)).replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const same = (a, b) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

export async function start({ scratch }) {
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const config = path.join(scratch, "gotosocial.yaml");
  fs.writeFileSync(
    config,
    [`host: "localhost:${port}"`, 'protocol: "http"', "port: 8080", 'db-type: "sqlite"', 'db-address: "/gotosocial/storage/sqlite.db"', 'storage-local-base-path: "/gotosocial/storage/media"', "letsencrypt-enabled: false", "advanced-rate-limit-requests: 0", "advanced-throttling-multiplier: 0"].join("\n") + "\n",
  );
  // Copied in rather than mounted: a scratch folder under the system's temp
  // directory is not shared with Docker's VM on every machine.
  const id = docker("create", "-p", `127.0.0.1:${port}:8080`, "--entrypoint", "/gotosocial/gotosocial", IMAGE, "server", "start", "--config-path", CONFIG);
  docker("cp", config, `${id}:${CONFIG}`);
  docker("start", id);
  const stop = async () => {
    docker("rm", "-f", id);
  };
  try {
    for (let i = 0; ; i++) {
      const up = await fetch(`${base}/api/v1/instance`).then((r) => r.ok, () => false);
      if (up) break;
      if (i > 60) throw new Error(`GoToSocial did not start: ${docker("logs", "--tail", "5", id)}`);
      await wait(500);
    }
    // Users can be made only once the server has run, and must be confirmed to sign in.
    for (const user of ["alex", "sam"]) {
      docker("exec", id, "/gotosocial/gotosocial", "admin", "account", "create", "--username", user, "--email", `${user}@example.org`, "--password", PASSWORD, "--config-path", CONFIG);
      docker("exec", id, "/gotosocial/gotosocial", "admin", "account", "confirm", "--username", user, "--config-path", CONFIG);
    }
    const author = await token(base, "alex");
    const reader = await token(base, "sam");
    const api = async (tok, p, init = {}) => {
      const r = await fetch(new URL(p, base), { ...init, headers: { authorization: `Bearer ${tok}`, ...(init.headers ?? {}) } });
      if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
      return r.json();
    };
    const me = await api(author, "/api/v1/accounts/verify_credentials");
    const follow = await api(reader, `/api/v1/accounts/${me.id}/follow`, { method: "POST" });
    // A server that makes accounts locked holds the follow as a request.
    if (!follow.following) {
      const sam = await api(reader, "/api/v1/accounts/verify_credentials");
      await api(author, `/api/v1/follow_requests/${sam.id}/authorize`, { method: "POST" });
    }
    if (!(await api(reader, `/api/v1/accounts/relationships?id[]=${me.id}`))[0]?.following) throw new Error("the reader does not follow the author");
    const statuses = () => api(author, `/api/v1/accounts/${me.id}/statuses?limit=80`);

    return {
      config: { server: base },
      secrets: { access_token: author },
      owns: (page) => new RegExp(`syndicated:[\\s\\S]*${base}/@alex/statuses/`).test(page),
      count: async () => (await statuses()).length,
      async verify(copies, check) {
        const all = await statuses();
        // The server fills home timelines in the background.
        let home = [];
        for (let i = 0; i < 20 && !copies.every((c) => home.some((s) => same(plain(s.content), c.parts[0].text))); i++) {
          if (i) await wait(500);
          home = await api(reader, "/api/v1/timelines/home?limit=80");
        }
        for (const copy of copies) {
          const texts = copy.parts.map((p) => p.text);
          const first = all.find((s) => !s.in_reply_to_id && same(plain(s.content), texts[0]));
          const seen = first ? "" : ` (planned ${JSON.stringify(texts[0])}; the account has ${JSON.stringify(all.map((s) => plain(s.content)))})`;
          check(Boolean(first), `${copy.source_path}: a ${copy.form} status with the planned text is on the account${seen}`);
          if (!first) continue;
          check(first.visibility === "public", `${copy.source_path}: the copy is public`);
          check(home.some((s) => s.id === first.id), `${copy.source_path}: a follower sees the copy on their home timeline`);
          let parent = first;
          for (const text of texts.slice(1)) {
            const next = all.find((s) => same(plain(s.content), text) && s.in_reply_to_id === parent.id);
            check(Boolean(next), `${copy.source_path}: "${text}" replies to the part before it`);
            if (next) parent = next;
          }
          for (const link of texts[0].match(/https?:\/\/\S+/g) ?? []) {
            const bare = link.replace(/[.,;:!?]+$/, "");
            check(first.content.includes(`href="${bare}"`), `${copy.source_path}: ${bare} is a link`);
          }
        }
      },
      stop,
    };
  } catch (e) {
    await stop();
    throw e;
  }
}
