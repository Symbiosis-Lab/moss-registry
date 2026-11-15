// The pay step in Chromium and WebKit, against a stub booking service and a stub Stripe.js that
// records what the page hands it. Needs Playwright with both browsers installed:
//   PLAYWRIGHT_FROM=<a package.json whose project has playwright> node --test plugins/booking/test/pay-step.browser.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium, webkit } = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url)("playwright");
const asset = (name) => readFileSync(new URL(`../assets/${name}`, import.meta.url), "utf8");

const SITE = "https://site.test";
const ENDPOINT = "https://booking.test/sites/s/booking";
const TOKENS = {
  bg: "oklch(0.145 0.006 60)",
  surface: "#1c1916",
  text: "oklch(0.955 0.008 80)",
  accent: "oklch(0.665 0.19 37)",
};

// The site's theme, as moss publishes it: tokens, and its own face beside the stylesheet.
const THEME = `@font-face { font-family: "Archivo"; src: url("fonts/Archivo.woff2") format("woff2"); font-weight: 100 900; }
:root { --moss-color-bg: ${TOKENS.bg}; --moss-color-surface: ${TOKENS.surface}; --moss-color-text: ${TOKENS.text};
  --moss-color-ui-accent: ${TOKENS.accent}; --moss-font-body: "Archivo", system-ui, sans-serif; --moss-font-mono: "Geist Mono", monospace; }
body { background: var(--moss-color-bg); margin: 0; }
html { scroll-padding-top: 80px; } header { position: sticky; top: 0; height: 80px; background: #000; } footer { height: 1600px; }`;
const PAGE = `<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/_moss/theme/style.css">
<link rel="stylesheet" href="/_moss/plugins/booking/moss-booking.css"><script type="module" src="/_moss/plugins/booking/moss-booking.js"></script>
<header></header><moss-booking page="book" desk="desk@site.test"><a href="mailto:desk@site.test">Email the desk</a></moss-booking><footer></footer>`;
const OFFER = {
  schema: 1,
  data: {
    endpoint: ENDPOINT, timezone: "America/Los_Angeles", currency: "usd",
    cancel: { full_before_hours: 24, late_percent: 50 }, pages: { book: "/book/", done: "/book/done/" },
    quoted: { events: { name: "Weddings and events" } },
    services: {
      studio: { name: "Studio hire", per_hour: 12000, hours: { min: 5, max: 12 }, deposit: { percent: 50, hold_hours: 12, balance_days_before: 7 } },
      // moss publishes a table's keys sorted, so the options arrive as cat, motor, rowboat, sail.
      boats: {
        name: "Boat hire", note: "Up to 4 hours on the lake.", hours: { min: 1, max: 4 },
        fields: { meeting_point: "required", party: "required", notes: "optional" },
        labels: { meeting_point: "Meeting point", party: "Who is coming", notes: "Anything we should know" },
        choice: { label: "Boat", options: {
          cat: { name: "Catamaran", per: "hour", price: 30000 }, motor: { name: "Motorboat", per: "hour", price: 16000 },
          rowboat: { name: "Rowboat", per: "hour", price: 11000 }, sail: { name: "Sailboat", per: "hour", price: 13500 },
        } },
        add_ons: { skipper: { name: "Skipper", per: "hour", price: 12000, qty: { min: 0, max: 4 } } },
      },
      chat: { name: "Planning chat", minutes: 20, price: 0, note: "On the dock" },
    },
  },
};
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const SLOTS = { timezone: "America/Los_Angeles", fresh: true, days: [{ date: day(10), slots: [{ start: `${day(10)}T18:00:00-08:00`, time: "18:00", open: true }] }] };
const CHECKOUT = { client_secret: "cs_test_1_secret_x", publishable_key: "pk_test_platform", account: "acct_site" };

// Stands in for Stripe.js: records the options, draws a placeholder, and answers confirm as the test says.
const FAKE_STRIPE = `window.Stripe = (key, options) => ({ initCheckout: async (init) => {
  window.seen = { key, options, elementsOptions: init.elementsOptions, secret: await init.fetchClientSecret() };
  if (window.initFails) throw new Error("Stripe is down");
  return {
    createPaymentElement: () => {
      const on = {};
      return { on: (name, f) => (on[name] = f), destroy: () => (window.destroyed = true),
        mount: (node) => { node.innerHTML = '<div class="fake-fields" style="height:240px"></div>'; window.mounted = true;
          window.ready = () => on.ready?.(); window.change = (e) => on.change?.(e); if (window.loadError) setTimeout(() => on.loaderror?.({}), 0); } };
    },
    changeAppearance: (a) => (window.appearances = [...(window.appearances || []), a]),
    confirm: () => { window.confirms = (window.confirms || 0) + 1; return window.answer ? window.answer() : new Promise(() => {}); },
  };
} });`;

// `wait` maps a path of the booking service to a function whose promise the answer waits for.
async function open(browser, { stripeDelay = 0, released = "expired", held = {}, kind = "book", extra = {}, wait = {}, lang = "en", offer = OFFER } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const sent = [];
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  await page.route(`${SITE}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const files = {
      "/book/": [PAGE.replace("<!doctype html>", `<!doctype html><html lang="${lang}">`).replace('page="book"', `page="${kind}"`), "text/html"], "/_moss/theme/style.css": [THEME, "text/css"], "/_moss/extensions/booking.json": [JSON.stringify(offer), "application/json"],
      "/_moss/plugins/booking/moss-booking.js": [asset("moss-booking.js"), "text/javascript"], "/_moss/plugins/booking/moss-booking.css": [asset("moss-booking.css"), "text/css"],
    };
    const file = files[path];
    return file ? route.fulfill({ body: file[0], contentType: file[1] }) : route.fulfill({ status: 404 });
  });
  await page.route(`${ENDPOINT}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname.replace(new URL(ENDPOINT).pathname, "");
    sent.push({ path, body: req.postDataJSON?.() ?? null });
    await wait[path]?.();
    const answers = {
      "/slots": [200, SLOTS],
      "/holds": held.status ? [held.status, held.body] : [201, { booking: "bk_1", status: "holding", amount: 60000, due_now: 30000, currency: "usd", checkout: CHECKOUT, ...held }],
      "/holds/release": [200, { booking: "bk_1", status: released }],
      ...extra,
    };
    const [status, json] = answers[path] ?? [404, {}];
    return route.fulfill({ status, json, headers: cors });
  });
  await page.route("https://js.stripe.com/**", async (route) => {
    if (stripeDelay) await new Promise((r) => setTimeout(r, stripeDelay));
    return route.fulfill({ body: FAKE_STRIPE, contentType: "text/javascript" });
  });
  return { page, sent };
}

async function toPay(page, { waitForPay = true } = {}) {
  await page.goto(`${SITE}/book/?service=studio`);
  await page.click("[data-start]");
  await page.fill("#f-name", "Ada Client");
  await page.fill("#f-email", "ada@example.com");
  await page.fill("#f-mobile", "+15555550100");
  await page.click("[type=submit]");
  if (waitForPay) await page.waitForSelector('h1:has-text("Pay $300")');
}

// An oracle independent of the page's pixel read: OKLCH to sRGB by the published matrices.
function oklchHex(l, c, h) {
  const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
  const [L, M, S] = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map((v) => v ** 3);
  const lin = [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S];
  return lin.map((v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))));
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const near = (hex, want, what) => assert.ok(rgb(hex).every((v, i) => Math.abs(v - want[i]) <= 2), `${what}: ${hex} is not ${want}`);

// A sailboat for 4 hours with 2 skippers.
const SAIL_FOUR_TWO = { total: 4 * 13500 + 2 * 4 * 12000 };
const dollars = (cents) => `$${(cents / 100).toLocaleString("en-US")}`;
const stepAt = (page) => page.locator(".steps .on").textContent();
// A button that shows it is waiting: marked busy, with the ring drawn in the arrow's place and turning.
const turning = (button) => button.evaluate((b) => {
  const ring = getComputedStyle(b, "::after");
  return b.getAttribute("aria-busy") === "true" && ring.content === '""' && ring.animationName === "moss-booking-turn" && parseFloat(ring.inlineSize) > 0;
});

async function fillBoat(page) {
  await page.fill("#f-name", "Ada Client");
  await page.fill("#f-email", "ada@example.com");
  await page.fill("#f-mobile", "+15555550100");
  await page.fill("#f-meeting_point", "North pier");
  await page.fill("#f-party", "Four adults");
}

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`${name}: a boat goes from the options to payment with the total on Book and Pay only`, async () => {
    const browser = await engine.launch();
    try {
      const { page, sent } = await open(browser, { held: { amount: SAIL_FOUR_TWO.total, due_now: SAIL_FOUR_TWO.total, pay: "full" } });
      await page.goto(`${SITE}/book/?service=boats`);
      assert.equal(await stepAt(page), "Book");
      assert.deepEqual(await page.locator(".steps span").allTextContents(), ["Choose", "Book", "Pay", "Confirmed"]);
      // The first option and the shortest booking are picked already: the total reads at once.
      assert.match(await page.locator(".sum").textContent(), /Total\$110/);
      assert.deepEqual(await page.locator("input[name=choice]").evaluateAll((l) => l.map((i) => i.value)), ["rowboat", "sail", "motor", "cat"]);
      await page.click("[data-start]");
      await page.fill("#f-name", "Ada Client");
      await page.click("input[name=choice][value=sail]", { force: true });
      assert.equal(await page.inputValue("#f-name"), "Ada Client", "typed text survives a redraw");
      for (let i = 0; i < 3; i++) await page.click("[data-hours][data-step='1']");
      for (let i = 0; i < 2; i++) await page.click("[data-addon=skipper][data-step='1']");
      assert.equal(await page.inputValue("#f-name"), "Ada Client", "typed text survives a new length");
      assert.equal(await page.locator(".sum").count(), 1);
      assert.equal((await page.locator(".sum").textContent()).replace(/\s/g, ""), `Total${dollars(SAIL_FOUR_TWO.total)}`);
      assert.equal(await page.locator("form [type=submit]").textContent(), `Pay ${dollars(SAIL_FOUR_TWO.total)}`);
      await fillBoat(page);
      await page.click("[type=submit]");
      await page.waitForSelector(`h1:has-text("Pay ${dollars(SAIL_FOUR_TWO.total)}")`);
      assert.equal(await stepAt(page), "Pay");
      assert.equal(await page.locator(".sum").count(), 0, "no second price screen");
      const hold = sent.find((r) => r.path === "/holds").body;
      assert.deepEqual({ ...hold, start: undefined }, {
        service: "boats", hours: 4, choice: "sail", add_ons: { skipper: 2 }, checkout: "elements", name: "Ada Client", email: "ada@example.com", mobile: "+15555550100",
        fields: { meeting_point: "North pier", party: "Four adults", notes: "" }, start: undefined,
      });
    } finally {
      await browser.close();
    }
  });

  test(`${name}: a refused hold comes back to the Book screen with what was typed`, async () => {
    const browser = await engine.launch();
    try {
      const { page } = await open(browser, { held: { status: 422, body: { error: "invalid", fields: { party: "required" } } } });
      await page.goto(`${SITE}/book/?service=boats`);
      await page.click("[data-start]");
      await fillBoat(page);
      await page.click("[type=submit]");
      await page.waitForSelector("[role=alert]");
      assert.equal(await stepAt(page), "Book");
      assert.equal(await page.inputValue("#f-meeting_point"), "North pier");
      assert.match(await page.locator("#err-party").textContent(), /fill this in/);
    } finally {
      await browser.close();
    }
  });

  test(`${name}: a total the service refuses says to check the choices, not a marked field`, async () => {
    const browser = await engine.launch();
    try {
      const { page } = await open(browser, { held: { status: 422, body: { error: "invalid", fields: { total: "format" } } } });
      await page.goto(`${SITE}/book/?service=boats`);
      await page.click("[data-start]");
      await fillBoat(page);
      await page.click("[type=submit]");
      assert.match(await page.locator("[role=alert]").textContent(), /Please check your choices\./);
    } finally {
      await browser.close();
    }
  });

  for (const kind of ["manage", "desk"]) {
    test(`${name}: the ${kind} page lists what was picked, and the desk words the questions as the offer does`, async () => {
      const browser = await engine.launch();
      try {
        const booking = {
          booking: "bk_1", status: "confirmed", service: "boats", service_name: "Boat hire", start: `${day(10)}T18:00:00-08:00`, hours: 4,
          selection: [["Boat", "Sailboat"], ["Skipper", "2"]], amount: 150000, currency: "usd", paid: 150000, deposit: null, balance: null, paid_with: "card",
          email: "ada@example.com", name: "Ada Client", mobile: "+15555550100", fields: { meeting_point: "North pier", party: "Four" },
          cancel: { allowed: false }, move: { allowed: false }, decline: { allowed: false },
        };
        const { page } = await open(browser, { kind, extra: { [`/${kind}`]: [200, booking] } });
        await page.goto(`${SITE}/book/#tokentokentokentokentoken`);
        await page.waitForSelector("text=Skipper");
        const text = await page.locator(".sum").first().textContent();
        assert.match(text, /BoatSailboat/);
        assert.match(text, /Skipper2/);
        if (kind === "desk") assert.match(await page.locator("moss-booking").textContent(), /Meeting pointNorth pier/);
      } finally {
        await browser.close();
      }
    });
  }

  test(`${name}: a boat is offered on Choose with its limits, and fits a phone`, async () => {
    const browser = await engine.launch();
    try {
      const { page } = await open(browser);
      await page.goto(`${SITE}/book/`);
      assert.match(await page.locator("[data-id=boats]").textContent(), /Boat hire.*From \$110 an hour · Up to 4 hours on the lake\./);
      await page.click("[data-id=boats]");
      await page.click("[data-go]");
      await page.waitForSelector("text=Up to 4 hours on the lake\.");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal scroll at 390px");
    } finally {
      await browser.close();
    }
  });

  test(`${name}: Continue, the hours and the Book screen's button turn while the service answers`, async () => {
    const browser = await engine.launch();
    try {
      let holding = false, release = () => {};
      const gate = () => holding && new Promise((ok) => (release = ok));
      const { page, sent } = await open(browser, { wait: { "/slots": gate, "/holds": gate } });
      const answer = async () => { holding = false; release(); await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]')); };
      await page.goto(`${SITE}/book/`);
      await page.click('[data-id="studio"]');

      holding = true;
      await page.click("[data-go]");
      assert.ok(await turning(page.locator("[data-go]")), "Continue while the times load");
      await page.click("[data-go]");
      await answer();
      assert.equal(sent.filter((r) => r.path === "/slots").length, 1, "a second press of Continue asks nothing");

      // One hour up from the shortest length, so the other sign can be pressed too.
      const more = page.locator('[aria-label="One hour more"]');
      await more.click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="One hour fewer"]').disabled);
      holding = true;
      await more.click();
      assert.ok(await turning(more), "One hour more while the times load");
      assert.equal(await page.locator(".stepper output").first().textContent(), "7", "the new length shows at once");
      await page.click('[aria-label="One hour fewer"]');
      await answer();
      assert.equal(await page.locator(".stepper output").first().textContent(), "7", "a press on the other sign while waiting changes nothing");
      assert.equal(sent.filter((r) => r.path === "/slots").length, 3, "and asks nothing");

      await page.click("[data-start]");
      await page.fill("#f-name", "Ada Client");
      await page.fill("#f-email", "ada@example.com");
      await page.fill("#f-mobile", "+15555550100");
      holding = true;
      await page.click("[type=submit]");
      assert.ok(await turning(page.locator("form [type=submit]")), "the Book screen's button while the time is held");
      holding = false; release();
      await page.waitForSelector('h1:has-text("Pay")');
    } finally {
      await browser.close();
    }
  });

  test(`${name}: Stripe's fields open on the site's account in the site's colours, face and corners`, async () => {
    const browser = await engine.launch();
    try {
      const { page, sent } = await open(browser);
      await toPay(page);
      await page.waitForFunction(() => window.mounted);
      assert.equal(sent.find((r) => r.path === "/holds").body.checkout, "elements");
      const seen = await page.evaluate(() => window.seen);
      assert.equal(seen.key, CHECKOUT.publishable_key);
      assert.deepEqual(seen.options, { stripeAccount: CHECKOUT.account });
      assert.equal(seen.secret, CHECKOUT.client_secret);
      const { variables: v, rules } = seen.elementsOptions.appearance;
      const bg = oklchHex(0.145, 0.006, 60), text = oklchHex(0.955, 0.008, 80);
      near(v.colorBackground, rgb(TOKENS.surface), "field background");
      near(v.colorText, text, "text");
      near(v.colorPrimary, oklchHex(0.665, 0.19, 37), "accent");
      // The flat theme draws an unticked box in the field colour: without an edge it vanishes on a dark site.
      for (const r of [".Input", ".CheckboxInput"]) near(rules[r].border.split(" ").pop(), text.map((t, i) => 0.16 * t + 0.84 * bg[i]), `${r} edge, translucent over the background`);
      assert.equal(rules[".CheckboxInput--checked"].backgroundColor, v.colorPrimary, "a ticked box in the accent");
      assert.equal(v.borderRadius, "2px");
      assert.match(v.fontFamily, /^"?Archivo"?, system-ui/);
      assert.deepEqual(seen.elementsOptions.fonts.map((f) => [f.family, f.src]), [["Archivo", `url("${SITE}/_moss/theme/fonts/Archivo.woff2") format("woff2")`]]);
    } finally {
      await browser.close();
    }
  });

  test(`${name}: a redesign reaches the fields, read when they open`, async () => {
    const browser = await engine.launch();
    try {
      const { page } = await open(browser);
      await page.goto(`${SITE}/book/?service=studio`);
      await page.addStyleTag({ content: "moss-booking { --booking-accent: #0055ff; --booking-radius: 12px; }" });
      await page.click("[data-start]");
      await page.fill("#f-name", "Ada Client");
      await page.fill("#f-email", "ada@example.com");
      await page.fill("#f-mobile", "+15555550100");
      await page.click("[type=submit]");
      await page.waitForFunction(() => window.mounted);
      const v = await page.evaluate(() => window.seen.elementsOptions.appearance.variables);
      assert.equal(v.colorPrimary, "#0055ff");
      assert.equal(v.borderRadius, "12px");
    } finally {
      await browser.close();
    }
  });

  test(`${name}: Pay waits for the fields, turns while it is paying, and shows Stripe's refusal in the page`, async () => {
    const browser = await engine.launch();
    try {
      const { page, sent } = await open(browser);
      await toPay(page);
      const pay = page.locator("form [type=submit]");
      await page.waitForFunction(() => window.mounted);
      assert.ok(await pay.isDisabled(), "Pay before Stripe's fields are ready");
      await page.evaluate(() => window.ready());
      await page.waitForFunction(() => !document.querySelector("form [type=submit]").disabled);
      await page.evaluate(() => window.change({ complete: true }));
      await page.evaluate(() => { window.answer = () => new Promise((ok) => (window.refuse = () => ok({ type: "error", error: { message: "Your card was declined.", code: "paymentFailed" } }))); });
      await pay.click();
      assert.equal(await pay.textContent(), "Pay");
      assert.ok(await turning(pay), "Pay while Stripe answers");
      await page.click("[data-back]");
      await page.waitForTimeout(150);
      assert.ok(!sent.some((r) => r.path === "/holds/release"), "Back while paying frees nothing");
      assert.match(await page.locator("h1").textContent(), /Pay \$300/, "Back while paying stays on Pay");
      await page.evaluate(() => window.refuse());
      await page.waitForSelector("[role=alert] >> text=Your card was declined.");
      assert.equal(await pay.textContent(), "Pay");
      assert.equal(await page.locator('[aria-busy="true"]').count(), 0, "nothing waits once Stripe has answered");

      // Said once: Stripe's copy under the card number is hidden, the site's look kept, until the next try.
      const { appearances, seen } = await page.evaluate(() => ({ appearances: window.appearances, seen: window.seen }));
      assert.equal(appearances?.length, 1, "Stripe's own copy of the refusal hidden");
      assert.equal(appearances[0].rules[".Error"].fontSize, "0px");
      assert.deepEqual(appearances[0].rules[".Input"], seen.elementsOptions.appearance.rules[".Input"]);
      // Stripe calls the card unfinished once it has refused it, and answers Pay pressed again with no code.
      await page.evaluate(() => window.change({ complete: false }));
      await page.evaluate(() => { window.answer = async () => ({ type: "error", error: { message: "Your card was declined.", code: null } }); });
      await pay.click();
      await page.waitForSelector("[data-problem] [role=alert] >> text=Your card was declined.");
      assert.equal(await pay.textContent(), "Pay");
      assert.equal((await page.evaluate(() => window.appearances)).length, 1, "Stripe's copy stays hidden while the page says it");
      // A new card ends it: Stripe's notes come back for whatever is typed next.
      await page.evaluate(() => window.change({ complete: true }));
      const back = await page.evaluate(() => window.appearances);
      assert.equal(back.length, 2);
      assert.deepEqual(back[1], seen.elementsOptions.appearance, "Stripe's notes back once the card is complete");
    } finally {
      await browser.close();
    }
  });

  test(`${name}: a field left unfinished keeps Stripe's note under it, and the page adds none`, async () => {
    const browser = await engine.launch();
    try {
      const { page } = await open(browser);
      await toPay(page);
      await page.waitForFunction(() => window.mounted);
      await page.evaluate(() => { window.ready(); window.change({ complete: false }); });
      await page.evaluate(() => { window.answer = async () => ({ type: "error", error: { message: "Your card number is incomplete.", code: null } }); });
      await page.click("form [type=submit]");
      await page.waitForFunction(() => document.querySelector("form [type=submit]").textContent === "Pay");
      assert.equal(await page.locator("[data-problem] [role=alert]").count(), 0);
      assert.equal(await page.evaluate(() => window.appearances), undefined);
    } finally {
      await browser.close();
    }
  });

  test(`${name}: a form that cannot load frees the time and names the desk`, async () => {
    const browser = await engine.launch();
    try {
      const { page, sent } = await open(browser);
      await page.addInitScript(() => { window.initFails = true; });
      await toPay(page, { waitForPay: false });
      await page.waitForSelector("text=The payment form did not load. Nothing was paid.");
      assert.ok(sent.some((r) => r.path === "/holds/release"));
    } finally {
      await browser.close();
    }
  });

  test(`${name}: Back while Stripe.js loads frees the time and no form opens`, async () => {
    const browser = await engine.launch();
    try {
      const { page, sent } = await open(browser, { stripeDelay: 800 });
      await toPay(page);
      await page.click("[data-back]");
      await page.waitForSelector("text=the time you chose is free again");
      await page.waitForFunction(() => window.Stripe);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
      assert.ok(sent.some((r) => r.path === "/holds/release"));
      assert.equal(await page.evaluate(() => window.seen), undefined);
    } finally {
      await browser.close();
    }
  });
  test(`${name}: fields that fail after opening free the time`, async () => {
    const browser = await engine.launch();
    try {
      const { page, sent } = await open(browser);
      await page.addInitScript(() => { window.loadError = true; });
      await toPay(page, { waitForPay: false });
      await page.waitForSelector("text=The payment form did not load. Nothing was paid.");
      assert.ok(sent.some((r) => r.path === "/holds/release"));
    } finally {
      await browser.close();
    }
  });

  test(`${name}: Back after the fields open closes them; a payment already going through is not called free`, async () => {
    const browser = await engine.launch();
    try {
      const { page } = await open(browser, { released: "holding" });
      await toPay(page);
      await page.waitForFunction(() => window.mounted);
      await page.click("[data-back]");
      await page.waitForSelector("text=Your payment is going through.");
      assert.equal(await page.evaluate(() => window.destroyed), true);
      assert.equal(await page.locator("text=free again").count(), 0);
    } finally {
      await browser.close();
    }
  });

  test(`${name}: a colour the canvas cannot read leaves Stripe's own colours, never white on white`, async () => {
    const browser = await engine.launch();
    try {
      const { page } = await open(browser);
      await page.addInitScript(() => {
        const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "fillStyle");
        Object.defineProperty(CanvasRenderingContext2D.prototype, "fillStyle", { get: d.get, set(v) { if (!/^(oklch|oklab|color\()/.test(String(v))) d.set.call(this, v); } });
      });
      await toPay(page);
      await page.waitForFunction(() => window.mounted);
      const options = await page.evaluate(() => window.seen.elementsOptions);
      assert.equal(options.appearance, undefined);
      assert.equal(options.fonts[0].family, "Archivo");
    } finally {
      await browser.close();
    }
  });
  test(`${name}: a screen opened from low on the page starts in full below the sticky header`, async () => {
    const browser = await engine.launch();
    try {
      const { page } = await open(browser);
      await page.goto(`${SITE}/book/?service=studio`);
      await page.click("[data-start]");
      await page.fill("#f-name", "Ada Client");
      await page.fill("#f-email", "ada@example.com");
      await page.fill("#f-mobile", "+15555550100");
      await page.evaluate(() => window.scrollTo(0, document.querySelector("form [type=submit]").getBoundingClientRect().top + scrollY - 200));
      await page.click("[type=submit]");
      await page.waitForSelector('h1:has-text("Pay $300")');
      const top = await page.evaluate(() => document.querySelector(".steps").getBoundingClientRect().top);
      assert.ok(top >= 80, `the step bar starts at ${top}px, under the 80px header`);
    } finally {
      await browser.close();
    }
  });

  test(`${name}: drawing the same screen again keeps the focused control and the scroll`, async () => {
    const browser = await engine.launch();
    try {
      const { page } = await open(browser);
      const focused = () => page.evaluate(() => { const a = document.activeElement; return [a.dataset.id, a.dataset.addon, a.dataset.step, a.dataset.start, a.name, a.value].filter(Boolean).join(" "); });
      // Starts the control in the middle of the window, then presses `key` on it.
      const press = async (selector, key) => {
        await page.locator(selector).first().evaluate((el) => { el.focus({ preventScroll: true }); scrollTo(0, el.getBoundingClientRect().top + scrollY - 400); });
        const y = await page.evaluate(() => scrollY);
        await page.keyboard.press(key);
        return y;
      };
      const still = async (y, what) => assert.equal(await page.evaluate(() => scrollY), y, `${what}: the page did not move`);

      await page.goto(`${SITE}/book/`);
      let y = await press("[data-id=boats]", "Enter");
      assert.equal(await page.getAttribute("[data-id=boats]", "aria-pressed"), "true");
      assert.equal(await focused(), "boats", "a service card keeps focus");
      await still(y, "a service card");

      await page.goto(`${SITE}/book/?service=boats`);
      y = await press("input[name=choice][value=rowboat]", "ArrowDown");
      assert.ok(await page.isChecked("input[name=choice][value=sail]"));
      assert.equal(await focused(), "choice sail", "arrowing through the options keeps focus on the one chosen");
      await still(y, "an option");
      assert.match(await page.locator(".sum").textContent(), /\$135/);

      y = await press("[data-addon=skipper][data-step='1']", "Enter");
      assert.equal(await page.locator("[data-addon=skipper] ~ output, .stepper output").first().textContent(), "1");
      assert.equal(await focused(), "skipper 1", "an add-on's sign keeps focus");
      await still(y, "an add-on's sign");
      for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
      assert.equal(await focused(), "skipper -1", "at the most, focus moves to the other sign");

      y = await press("[data-start]", "Space");
      assert.equal(await page.getAttribute("[data-start]", "aria-pressed"), "true");
      assert.match(await focused(), /^\d{4}-/, "a time keeps focus");
      await still(y, "a time");
    } finally {
      await browser.close();
    }
  });

  test(`${name}: every button that sends is inert on a second press and released when its answer fails`, async () => {
    const browser = await engine.launch();
    try {
      let shut = false, open_ = () => {};
      const gate = () => shut && new Promise((ok) => (open_ = ok));
      const waits = Object.fromEntries(["/slots", "/holds", "/manage/cancel", "/manage/move", "/manage/slots", "/desk/decline"].map((p) => [p, gate]));
      const settle = async (page) => page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
      // Presses `selector` twice while the answer to `path` is held; then lets the answer come.
      const twice = async (page, sent, path, selector, what) => {
        const count = () => sent.filter((r) => r.path === path).length;
        const before = count();
        shut = true;
        await page.click(selector);
        while (count() === before) await page.waitForTimeout(20);
        assert.ok(await turning(page.locator(selector)), `${what} turns while it waits`);
        await page.click(selector, { force: true });
        await page.waitForTimeout(150);
        assert.equal(count(), before + 1, `${what}: a second press sends nothing`);
        shut = false; open_();
        await settle(page);
        return count;
      };
      const failing = { "/slots": [500, {}], "/holds": [500, {}], "/manage/cancel": [500, {}], "/manage/move": [500, {}], "/desk/decline": [500, {}] };

      // Continue: a failed read of the times ends on the unavailable screen with nothing turning. The hours: one read per press.
      {
        const { page, sent } = await open(browser, { wait: waits, extra: { "/slots": [500, {}] } });
        await page.goto(`${SITE}/book/`);
        await twice(page, sent, "/slots", "[data-go]", "Continue");
        assert.match(await page.locator("h1").textContent(), /unavailable/);
        await page.close();
      }
      {
        const { page, sent } = await open(browser, { wait: waits });
        await page.goto(`${SITE}/book/?service=studio`);
        await twice(page, sent, "/slots", "[aria-label='One hour more']", "One hour more");
        await page.close();
      }
      // Book: the refusal comes back to the Book screen, whose button sends again.
      {
        const { page, sent } = await open(browser, { wait: waits, extra: { "/holds": [500, {}] } });
        await page.goto(`${SITE}/book/?service=studio`);
        await page.click("[data-start]");
        await page.fill("#f-name", "Ada Client");
        await page.fill("#f-email", "ada@example.com");
        await page.fill("#f-mobile", "+15555550100");
        const count = await twice(page, sent, "/holds", "form [type=submit]", "Book");
        assert.match(await page.locator("[role=alert]").textContent(), /Something went wrong/);
        await page.click("form [type=submit]");
        while (count() < 2) await page.waitForTimeout(20);
        await page.close();
      }
      // Pay: a refusal from Stripe leaves Pay pressable again.
      {
        const { page } = await open(browser);
        await toPay(page);
        await page.evaluate(() => { window.ready(); window.change({ complete: true }); let no; window.answer = () => new Promise((r) => (no = r)); window.refuse = () => no({ type: "error", error: { code: "card_declined", message: "Declined." } }); });
        await page.click("form [type=submit]");
        assert.ok(await turning(page.locator("form [type=submit]")), "Pay turns while it waits");
        await page.click("form [type=submit]", { force: true });
        assert.equal(await page.evaluate(() => window.confirms), 1, "Pay: a second press confirms nothing");
        await page.evaluate(() => window.refuse());
        await settle(page);
        await page.evaluate(() => (window.answer = () => Promise.resolve({ type: "error", error: { code: "card_declined", message: "Declined." } })));
        await page.click("form [type=submit]");
        await page.waitForFunction(() => window.confirms === 2);
        await page.close();
      }
      // Cancel, and Move with its chips, on the manage page; Decline on the desk page.
      const booking = {
        booking: "bk_1", status: "confirmed", service: "studio", service_name: "Studio hire", start: `${day(10)}T18:00:00-08:00`, hours: 5,
        amount: 60000, currency: "usd", deposit: null, balance: null, email: "ada@example.com", name: "Ada Client", mobile: "+15555550100", fields: {},
        cancel: { allowed: true, refund: 60000, rule: "full", full_until: `${day(9)}T18:00:00-08:00` },
        move: { allowed: true, until: `${day(9)}T18:00:00-08:00` }, decline: { allowed: true, how: "refund", returns: 60000 },
      };
      const twoDays = { fresh: true, days: [day(10), day(11)].map((d) => ({ date: d, slots: [{ start: `${d}T18:00:00-08:00`, time: "18:00", open: true }] })) };
      {
        const { page, sent } = await open(browser, { kind: "manage", wait: waits, extra: { ...failing, "/manage": [200, booking], "/manage/slots": [200, twoDays] } });
        await page.goto(`${SITE}/book/#tokentokentokentokentoken`);
        await page.click("[data-cancel]");
        const cancels = await twice(page, sent, "/manage/cancel", "[data-yes]", "Cancel");
        await page.click("[data-yes]");
        while (cancels() < 2) await page.waitForTimeout(20);
        await settle(page);
        await page.click("[data-no]");
        await twice(page, sent, "/manage/slots", "[data-move]", "Move to another time");
        for (const chip of await page.locator("[data-date]").all()) await chip.click();
        await page.click("[data-start]");
        assert.equal(sent.filter((r) => r.path === "/manage/slots").length, 1, "the move screen's chips ask nothing");
        const moves = await twice(page, sent, "/manage/move", "[data-go]", "Move");
        await page.click("[data-start]");
        await page.click("[data-go]");
        while (moves() < 2) await page.waitForTimeout(20);
        await page.close();
      }
      {
        const { page, sent } = await open(browser, { kind: "desk", wait: waits, extra: { ...failing, "/desk": [200, booking] } });
        await page.goto(`${SITE}/book/#tokentokentokentokentoken`);
        await page.fill("#f-reason", "The studio is closed that day.");
        const declines = await twice(page, sent, "/desk/decline", "[data-decline] [type=submit]", "Decline");
        await page.fill("#f-reason", "The studio is closed that day.");
        await page.click("[data-decline] [type=submit]");
        while (declines() < 2) await page.waitForTimeout(20);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });

  test(`${name}: the hosted checkout is followed to Stripe's address only`, async () => {
    const browser = await engine.launch();
    try {
      for (const [url, goes] of [["https://pay.example.test/c/1", false], ["https://checkout.stripe.com/c/pay/cs_1", true]]) {
        const { page } = await open(browser, { held: { checkout: undefined, checkout_url: url } });
        await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ body: "<title>Stripe</title>", contentType: "text/html" }));
        await page.route("https://pay.example.test/**", (route) => route.fulfill({ body: "<title>Elsewhere</title>", contentType: "text/html" }));
        await toPay(page, { waitForPay: false });
        if (goes) await page.waitForURL(url);
        else assert.match(await page.locator("[role=alert]").textContent(), /Something went wrong/);
        assert.equal(page.url().startsWith(url), goes, url);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });

  test(`${name}: Pay says so when the service's figure differs from the Book screen's`, async () => {
    const browser = await engine.launch();
    try {
      const { page } = await open(browser, { held: { due_now: 31000 } });
      await toPay(page, { waitForPay: false });
      await page.waitForSelector('h1:has-text("Pay $310")');
      assert.match(await page.locator("[role=alert]").textContent(), /The total is now \$310\./);
      await page.close();
      const same = await open(browser);
      await toPay(same.page);
      assert.equal(await same.page.locator("[role=alert]").count(), 0);
    } finally {
      await browser.close();
    }
  });

  test(`${name}: a page in Chinese reads the visitor words in Chinese, with the money in the offer's currency`, async () => {
    const browser = await engine.launch();
    try {
      const { page } = await open(browser, { lang: "zh", offer: { ...OFFER, data: { ...OFFER.data, currency: "eur" } } });
      await page.goto(`${SITE}/book/`);
      assert.equal(await page.locator("h1").textContent(), "选择服务");
      assert.equal(await page.locator("[data-go]").textContent(), "继续");
      assert.match(await page.locator("[data-id=studio]").textContent(), /每小时 €120 · 至少 5 小时/);
      await page.click("[data-id=studio]");
      await page.click("[data-go]");
      await page.waitForSelector("text=开始时间");
      assert.match(await page.locator("form").textContent(), /合计/);
    } finally {
      await browser.close();
    }
  });
}
