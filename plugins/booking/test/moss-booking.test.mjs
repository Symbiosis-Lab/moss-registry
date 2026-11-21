// node --test plugins/booking/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../assets/moss-booking.js", import.meta.url), "utf8");

const PUBLISHED = { schema: 1, data: { endpoint: "https://booking.example" } };

/** A `<moss-booking>` as the script sees it: markup drawn into it is kept as text; listeners on `selector` land in `handlers`. */
function element(Element, page, handlers = {}) {
  const view = new Element();
  let html = "";
  Object.defineProperty(view, "innerHTML", { get: () => html, set: (v) => (html = String(v)) });
  Object.assign(view, {
    attrs: { page },
    addEventListener() {},
    querySelector: (selector) => ({ addEventListener: (_type, fn) => (handlers[selector] = fn), focus() {}, setAttribute() {}, removeAttribute() {} }),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0 }),
  });
  return view;
}

/** Runs the script with `fetch` answering as given; returns the element class it defines. */
function load(fetch, extra = {}) {
  let Element;
  vm.runInNewContext(SOURCE, {
    HTMLElement: class { getAttribute(name) { return this.attrs[name] ?? null; } },
    customElements: { define: (_name, cls) => (Element = cls) },
    location: { hash: "", search: "" },
    URLSearchParams,
    document: { documentElement: {} },
    getComputedStyle: () => ({ scrollPaddingTop: "0px" }),
    fetch,
    ...extra,
  });
  return Element;
}

/** Mounts `<moss-booking page=…>` at an address with no fragment and returns what it drew. */
async function open(page, published = PUBLISHED, documentElement = {}) {
  const view = element(load(async () => ({ ok: true, status: 200, json: async () => published }), { document: { documentElement } }), page);
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

test("a page in Simplified Chinese reads the visitor words in Chinese; any other Chinese page reads English", async () => {
  assert.match(await open("manage", PUBLISHED, { lang: "zh" }), /确认邮件/);
  assert.match(await open("manage", PUBLISHED, { lang: "zh-Hans-CN" }), /确认邮件/);
  assert.match(await open("manage", PUBLISHED, { lang: "zh-Hant" }), /confirmation email/);
  assert.match(await open("manage", PUBLISHED, { lang: "en" }), /confirmation email/);
});

test("the offer's words replace the page's, as text", async () => {
  const html = await open("manage", { schema: 1, data: { ...PUBLISHED.data, words: { manage_title: "<b>Your trip</b>", confirmation_email: 7 } } });
  assert.match(html, /&lt;b&gt;Your trip&lt;\/b&gt;/);
  assert.match(html, /confirmation email/);
});

test("a published offer in a format other than schema 1 leaves the page's own content", async () => {
  assert.equal(await open("desk", { schema: 2, data: PUBLISHED.data }), "");
  assert.equal(await open("desk", PUBLISHED.data), "");
  assert.notEqual(await open("desk"), "");
});

test("the plugin speaks for no one client: none of its files carries a word of one client's offer or theme", () => {
  for (const name of ["moss-booking.js", "moss-booking.css", "manifest.json"]) {
    const text = readFileSync(new URL(`../assets/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /meta ?force|protection|bodyguard|\bguards?\b|patrol|secured ride|vehicle|sedan|\bSUV\b|armou?red|by phone|\btrip\b|--orange|--tan\b|--ink\b/i, name);
  }
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
  const Element = load(async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes("/slots")
    ? { fresh: true, days: [{ date: "2026-12-01", slots: [{ start: "2026-12-01T10:00:00-08:00", open: true }] }] }
    : { schema: 1, data: projected(offer) }) }));
  const view = element(Element, "book", handlers);
  view.connectedCallback();
  for (let i = 0; i < 10 && !handlers["[data-go]"]; i++) await new Promise((r) => setTimeout(r, 0));
  handlers["[data-go]"]();
  for (let i = 0; i < 10 && !view.innerHTML.includes("stepper"); i++) await new Promise((r) => setTimeout(r, 0));
  assert.match(view.innerHTML, /aria-label="One hour more" disabled/);
});

const VECTORS = JSON.parse(readFileSync(new URL("./price-vectors.json", import.meta.url), "utf8"));

/** The page's own price formula, taken out of the script. */
function totalOf() {
  const context = { HTMLElement: class {}, customElements: { define() {} } };
  vm.runInNewContext(SOURCE, context);
  return context.totalOf;
}

// Commerce runs the same file against its formula, so the two cannot drift apart.
for (const v of VECTORS.cases) {
  test(`the page prices ${v.name} as the booking service does`, () => {
    assert.equal(totalOf()(VECTORS.services[v.service], v.hours, { choice: v.choice, add_ons: v.add_ons }), v.total);
  });
}

/** The page's own deposit rules, taken out of the script. */
function deposits() {
  const context = { HTMLElement: class {}, customElements: { define() {} } };
  vm.runInNewContext(SOURCE, context);
  return context;
}

for (const v of VECTORS.deposits) {
  test(`the page holds the deposit the booking service holds: ${v.name}`, () => {
    assert.equal(deposits().depositOf(v.total, v.percent), v.deposit);
  });
}

for (const v of VECTORS.deposit_starts) {
  test(`the page ${v.allowed ? "offers" : "does not offer"} a deposit as the booking service does: ${v.name}`, () => {
    assert.equal(deposits().depositAllowed(Date.parse(v.start), Date.parse(v.now), v.balance_days_before), v.allowed);
  });
}

test("the manifest publishes every key of the services the vectors price", () => {
  assert.deepEqual(projected({ services: VECTORS.services }).services, VECTORS.services);
});

test("the manifest publishes every key the booking service reads from an offer", () => {
  const offer = {
    endpoint: "https://booking.example", enabled: true, timezone: "America/Los_Angeles", currency: "usd",
    open: { mon: ["09:00-17:00"], sat: ["10:00-14:00", "15:00-18:00"] }, start_every: 60, notice_hours: 12, horizon_days: 60,
    cancel: { full_before_hours: 24, late_percent: 50 }, pages: { book: "/book/", done: "/book/done/", manage: "/book/manage/", desk: "/book/desk/" },
    services: { ...VECTORS.services, protection: { ...VECTORS.services.protection, charge: "hourly", deposit: { percent: 50, hold_hours: 12, balance_days_before: 7 } } },
  };
  assert.deepEqual(projected(offer), offer);
});

// Commerce's copy of the vectors is the source. This is a copy, pinned: when commerce's file changes,
// its own test fails until its checksum is updated there, and the new file is copied here with the new checksum.
const VECTORS_SHA256 = "ea4e76c04a39b96c24255f7efa7470c3cb2623763a930dee1b5adf1d357a667b";
test("the vectors are the copy of commerce's file that the checksum names", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("./price-vectors.json", import.meta.url))).digest("hex"), VECTORS_SHA256);
});
