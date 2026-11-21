// A Mastodon server's sign-in endpoints, on loopback: app registration, the
// authorize page a person approves (here it approves at once and redirects to
// the plugin's loopback callback), the token exchange, who signed in, revoke.
import http from "node:http";

export async function start() {
  const apps = new Map();
  const codes = new Map();
  const tokens = new Set();
  const revoked = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const body = await new Promise((done) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => done(b ? JSON.parse(b) : {}));
    });
    const reply = (status, json, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(json));
    };
    if (url.pathname === "/api/v1/instance") return reply(200, { uri: `127.0.0.1:${port}`, version: "4.3.0", title: "Test" });
    if (url.pathname === "/api/v1/apps" && req.method === "POST") {
      const id = `app${apps.size + 1}`;
      apps.set(id, { secret: `secret-${id}`, redirect: body.redirect_uris });
      return reply(200, { client_id: id, client_secret: `secret-${id}` });
    }
    if (url.pathname === "/oauth/authorize") {
      const p = url.searchParams;
      if (!apps.has(p.get("client_id"))) return reply(401, { error: "invalid_client" });
      const code = `code${codes.size + 1}`;
      codes.set(code, p.get("client_id"));
      const back = new URL(p.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", p.get("state"));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/oauth/token" && req.method === "POST") {
      if (codes.get(body.code) !== body.client_id || apps.get(body.client_id)?.secret !== body.client_secret) return reply(400, { error: "invalid_grant" });
      const token = `token-${body.code}`;
      tokens.add(token);
      return reply(200, { access_token: token, token_type: "Bearer", scope: body.scope });
    }
    if (url.pathname === "/api/v1/accounts/verify_credentials") {
      if (!tokens.has((req.headers.authorization ?? "").replace("Bearer ", ""))) return reply(401, { error: "The access token is invalid" });
      return reply(200, { id: "109", username: "ada", acct: "ada", display_name: "Ada", url: `http://127.0.0.1:${port}/@ada` });
    }
    if (url.pathname === "/oauth/revoke" && req.method === "POST") {
      tokens.delete(body.token);
      revoked.push(body.token);
      return reply(200, {});
    }
    reply(404, { error: "not found" });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  return {
    address: `http://127.0.0.1:${port}`,
    revoked,
    stop: () => new Promise((done) => server.close(done)),
  };
}
