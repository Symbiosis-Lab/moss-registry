// Bluesky: the AT Protocol's own development network (a PLC directory and a
// data server, in process). A test account signs in with an app password, as
// a real author would; the check reads the posts back from the account's repo.

import { TestNetworkNoAppView } from "@atproto/dev-env";

export async function start() {
  const net = await TestNetworkNoAppView.create({});
  const pds = net.pds.url;
  const call = async (method, body, token) => {
    const r = await fetch(`${pds}/xrpc/${method}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`${method}: ${data.message ?? r.status}`);
    return data;
  };
  const account = await call("com.atproto.server.createAccount", { handle: "alex.test", email: "alex@example.org", password: "account-password" });
  const appPassword = await call("com.atproto.server.createAppPassword", { name: "moss" }, account.accessJwt);

  const records = async () =>
    (await call(`com.atproto.repo.listRecords?repo=${account.did}&collection=app.bsky.feed.post&limit=100`)).records;

  return {
    config: { handle: "alex.test", service: pds },
    secrets: { app_password: appPassword.password },
    // After a lost answer: the copy's keys come from the post, so it is found though its words changed.
    recovers: "adopt",
    edits: false,
    owns: (page) => /syndicated:[\s\S]*https:\/\/bsky\.app\/profile\/alex\.test\/post\//.test(page),
    count: async () => (await records()).length,
    async verify(copies, check) {
      const all = await records();
      for (const copy of copies) {
        const texts = copy.parts.map((p) => p.text);
        const first = all.find((r) => r.value.text === texts[0] && !r.value.reply);
        check(Boolean(first), `${copy.source_path}: a ${copy.form} post with the planned text is on the account`);
        if (!first) continue;
        let parent = first;
        for (const text of texts.slice(1)) {
          const next = all.find((r) => r.value.text === text && r.value.reply?.parent?.uri === parent.uri);
          check(Boolean(next) && next.value.reply.root.uri === first.uri, `${copy.source_path}: "${text}" replies to the part before it, in the same thread`);
          if (next) parent = next;
        }
        for (const link of copy.parts[0].text.match(/https?:\/\/\S+/g) ?? []) {
          const facet = (first.value.facets ?? []).find((f) => f.features?.[0]?.uri === link.replace(/[.,;:!?]+$/, ""));
          check(Boolean(facet), `${copy.source_path}: ${link} is a link`);
        }
        if (copy.form === "teaser") check(first.value.embed?.external?.uri === copy.link_card?.url, `${copy.source_path}: the teaser carries a card linking the original`);
      }
    },
    stop: () => net.close(),
  };
}
