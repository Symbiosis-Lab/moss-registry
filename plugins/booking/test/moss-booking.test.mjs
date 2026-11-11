// node --test plugins/booking/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../assets/moss-booking.js", import.meta.url), "utf8");

const PUBLISHED = { schema: 1, data: { endpoint: "https://booking.example" } };

/** Mounts `<moss-booking page=…>` at an address with no fragment and returns what it drew. */
async function open(page, published = PUBLISHED) {
  let Element;
  const context = {
    HTMLElement: class { getAttribute(name) { return this.attrs[name] ?? null; } },
    customElements: { define: (_name, cls) => (Element = cls) },
    location: { hash: "" },
    document: { documentElement: {} },
    getComputedStyle: () => ({ scrollPaddingTop: "0px" }),
    fetch: async () => ({ ok: true, status: 200, json: async () => published }),
  };
  vm.runInNewContext(SOURCE, context);
  const view = new Element();
  view.attrs = { page };
  view.innerHTML = "";
  view.querySelector = () => null;
  view.getBoundingClientRect = () => ({ top: 0 });
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

test("a published offer in a format other than schema 1 leaves the page's own content", async () => {
  assert.equal(await open("desk", { schema: 2, data: PUBLISHED.data }), "");
  assert.equal(await open("desk", PUBLISHED.data), "");
  assert.notEqual(await open("desk"), "");
});

const MANIFEST = JSON.parse(readFileSync(new URL("../assets/manifest.json", import.meta.url), "utf8"));

/** What moss publishes of `table`: only the manifest's `public_data.keys`, `*` standing for any one key. */
function projected(table, keys = MANIFEST.contributes.public_data.keys) {
  const out = {};
  for (const key of keys) {
    const walk = (from, to, [step, ...rest]) => {
      for (const name of step === "*" ? Object.keys(from ?? {}) : [step]) {
        if (from?.[name] === undefined) continue;
        if (rest.length === 0) to[name] = from[name];
        else walk(from[name], (to[name] ??= {}), rest);
      }
    };
    walk(table, out, key.split("."));
  }
  return out;
}

test("the hour stepper stops at the longest booking the published offer allows", async () => {
  const offer = {
    endpoint: "https://booking.example", timezone: "America/Los_Angeles", currency: "usd",
    cancel: { full_before_hours: 24, late_percent: 50 }, pages: { book: "/book/" },
    services: { guard: { name: "Guard", per_hour: 10000, hours: { min: 4, max: 4 } } },
  };
  const handlers = {};
  const stub = (selector) => ({ addEventListener: (_type, fn) => (handlers[selector] = fn), focus() {} });
  let Element;
  const context = {
    HTMLElement: class { getAttribute(name) { return this.attrs[name] ?? null; } },
    customElements: { define: (_name, cls) => (Element = cls) },
    location: { hash: "", search: "" },
    URLSearchParams,
    document: { documentElement: {} },
    getComputedStyle: () => ({ scrollPaddingTop: "0px" }),
    fetch: async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes("/slots")
      ? { fresh: true, days: [{ date: "2026-12-01", slots: [{ start: "2026-12-01T10:00:00-08:00", open: true }] }] }
      : { schema: 1, data: projected(offer) }) }),
  };
  vm.runInNewContext(SOURCE, context);
  const view = new Element();
  view.attrs = { page: "book" };
  view.innerHTML = "";
  view.querySelector = stub;
  view.querySelectorAll = () => [];
  view.getBoundingClientRect = () => ({ top: 0 });
  view.connectedCallback();
  for (let i = 0; i < 10 && !handlers["[data-go]"]; i++) await new Promise((r) => setTimeout(r, 0));
  handlers["[data-go]"]();
  for (let i = 0; i < 10 && !view.innerHTML.includes("stepper"); i++) await new Promise((r) => setTimeout(r, 0));
  assert.match(view.innerHTML, /aria-label="One hour more" disabled/);
});
