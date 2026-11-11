// node --test plugins/booking/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../assets/moss-booking.js", import.meta.url), "utf8");

/** Mounts `<moss-booking page=…>` at an address with no fragment and returns what it drew. */
async function open(page) {
  let Element;
  const context = {
    HTMLElement: class { getAttribute(name) { return this.attrs[name] ?? null; } },
    customElements: { define: (_name, cls) => (Element = cls) },
    location: { hash: "" },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ data: { endpoint: "https://booking.example" } }) }),
  };
  vm.runInNewContext(SOURCE, context);
  const view = new Element();
  view.attrs = { page };
  view.innerHTML = "";
  view.querySelector = () => null;
  view.connectedCallback();
  for (let i = 0; i < 10 && !view.innerHTML; i++) await new Promise((r) => setTimeout(r, 0));
  return view.innerHTML;
}

for (const [page, email] of [["desk", "booking notification email"], ["manage", "confirmation email"]]) {
  test(`the ${page} page opened without its link says it opens from the ${email}, not that booking is down`, async () => {
    const html = await open(page);
    assert.match(html, new RegExp(email));
    assert.doesNotMatch(html, /unavailable/i);
  });
}
