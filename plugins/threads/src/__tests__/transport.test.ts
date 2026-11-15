import http from "node:http";
import { expect, it, vi } from "vitest";
vi.mock("@symbiosis-lab/moss-api", () => ({ getSecret: vi.fn(async () => "loopback-only-token") }));
import { publish_copy } from "../main";

it.each([301, 302, 303, 307, 308])("does not follow HTTP %s redirects with a credential", async (status) => {
  let redirected = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/redirect-target") { redirected++; res.end("{}"); }
    else { res.writeHead(status, { location: "/redirect-target" }); res.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const result = await publish_copy({ op: "publish", channel: "threads", idempotency_key: "test", post: { url: "https://example.org/", source_path: "note.md", title: "" }, form: "short", parts: [{ text: "Hello https://example.org/", links: [] }], config: { api: `http://127.0.0.1:${address.port}` } });
    expect(result.success).toBe(false);
    expect(redirected).toBe(0);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
