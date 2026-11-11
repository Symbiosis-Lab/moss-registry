// <moss-booking>: choosing, paying for, moving and cancelling a booking, on the page that
// places it. The element's children stay until the offer loads, so they are what shows with
// no script or no offer. Reads the offer the site publishes; talks to the service named there.
async function mount(view, page, DESK, ENDPOINT) {

  const DAYS_SHOWN = 14;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (cents, currency) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 });
  // A new screen starts at its top: one that begins above the page's scroll-padding (the room a
  // sticky site header takes) is brought back into view below it.
  const show = (html) => {
    view.innerHTML = html;
    const room = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    if (view.getBoundingClientRect().top < room) view.scrollIntoView({ block: "start" });
    view.querySelector("h1")?.focus({ preventScroll: true });
  };

  // The service's times carry the site's offset, so the wall-clock time is read off the text, never converted.
  const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const utcDay = (date) => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  function dayLabel(date) {
    const at = new Date(utcDay(date));
    return { weekday: WEEKDAY[at.getUTCDay()], day: at.getUTCDate(), month: MONTH[at.getUTCMonth()] };
  }
  const dateLabel = (date) => { const l = dayLabel(date); return `${l.weekday} ${l.day} ${l.month}`; };
  const whenLabel = (instant) => `${dateLabel(instant.slice(0, 10))}, ${instant.slice(11, 16)}`;
  const daysBefore = (date, days) => new Date(utcDay(date) - days * 864e5).toISOString().slice(0, 10);
  const PAID_WITH = { card: "card", link: "Link", apple_pay: "Apple Pay", crypto: "USDC" };

  // The offer the site publishes. A fence's `endpoint` beats the site's.
  async function offer() {
    try {
      const published = await fetch("/_moss/extensions/booking.json", { cache: "no-store" });
      if (!published.ok) return null;
      const body = await published.json();
      // A format this element was not written for: keep the page's own content.
      if (body?.schema !== 1) return null;
      const booking = body.data;
      if (booking?.enabled === false) return null;
      const address = ENDPOINT || booking?.endpoint;
      return address ? { ...booking, endpoint: address } : null;
    } catch {
      return null;
    }
  }

  async function call(booking, path, body) {
    const init = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
    try {
      const r = await fetch(booking.endpoint.replace(/\/$/, "") + path, init);
      return { status: r.status, data: await r.json().catch(() => ({})) };
    } catch {
      return { status: 0, data: {} };
    }
  }

  // Stripe asks that Stripe.js load from its own address, never bundled. The path picks Stripe's
  // API version, which must be the booking service's own.
  const stripeJs = () => window.Stripe ? Promise.resolve(window.Stripe) : new Promise((ok, no) => {
    const tag = Object.assign(document.createElement("script"), { src: "https://js.stripe.com/basil/stripe.js", onload: () => (window.Stripe ? ok(window.Stripe) : no()), onerror: no });
    document.head.append(tag);
  });

  // Stripe draws the card fields in its own frame, where the page's CSS cannot reach, so they take
  // the site's look through Stripe's Appearance API, read from this element's tokens as they open.
  // Stripe takes colours only as hex: each token is painted on one pixel and read back, flattened
  // onto the background where it is translucent. A colour the canvas cannot parse leaves Stripe's own.
  function siteLook() {
    const css = getComputedStyle(view);
    const sans = css.getPropertyValue("--sans").trim();
    const probe = view.appendChild(Object.assign(document.createElement("span"), { className: "lab" }));
    const label = getComputedStyle(probe);
    const labelRule = { fontFamily: label.fontFamily, fontSize: label.fontSize, fontWeight: label.fontWeight, textTransform: label.textTransform, letterSpacing: label.letterSpacing };
    const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const hex = (token, under = "#ffffff") => {
      probe.style.color = `var(${token})`;
      pixel.fillStyle = "#010203";
      pixel.fillStyle = getComputedStyle(probe).color;
      const color = pixel.fillStyle;
      if (color === "#010203") throw new Error(`unreadable ${token}`);
      pixel.fillStyle = under;
      pixel.fillRect(0, 0, 1, 1);
      pixel.fillStyle = color;
      pixel.fillRect(0, 0, 1, 1);
      return "#" + [...pixel.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((c) => c.toString(16).padStart(2, "0")).join("");
    };
    const fonts = fontsOf([sans, labelRule.fontFamily]);
    try {
      const bg = hex("--bg");
      const [surface, text, text2, muted, accent, line2] = ["--surface", "--text", "--text-2", "--muted", "--orange", "--line-2"].map((t) => hex(t, bg));
      const edge = { border: `1px solid ${line2}`, boxShadow: "none", backgroundColor: surface };
      const lit = { borderColor: accent, boxShadow: `inset 0 0 0 1px ${accent}` };
      return {
        fonts,
        appearance: {
          theme: "flat",
          variables: {
            colorPrimary: accent, colorBackground: surface, colorText: text, colorTextSecondary: text2,
            colorTextPlaceholder: muted, colorDanger: accent, iconColor: text2, fontFamily: sans,
            fontSizeBase: css.fontSize, borderRadius: css.getPropertyValue("--radius").trim(), focusBoxShadow: "none",
          },
          rules: {
            ".Label": { ...labelRule, color: muted },
            ".Input": edge, ".Tab": { ...edge, color: text2 }, ".AccordionItem": edge, ".PickerItem": edge, ".Block": edge,
            ".Input:focus": lit, ".Tab:focus": lit, ".Tab--selected": { ...lit, color: text }, ".AccordionItem--selected": lit,
            ".CheckboxInput": edge, ".CheckboxInput--checked": { backgroundColor: accent, borderColor: accent },
          },
        },
      };
    } catch {
      return { fonts };
    } finally {
      probe.remove();
    }
  }

  // The site's own @font-face rules for the families the fields use, with absolute addresses,
  // since Stripe loads them inside its frame. A stylesheet from another origin cannot be read and is skipped.
  function fontsOf(stacks) {
    const unquote = (name) => name.trim().replace(/^["']|["']$/g, "");
    const families = new Set(stacks.map((s) => unquote(s.split(",")[0])));
    const out = [];
    const walk = (sheet) => {
      let rules;
      try { rules = sheet.cssRules; } catch { return; }
      const base = sheet.href || document.baseURI;
      const each = (list) => { for (const rule of list) {
        if (rule.styleSheet) walk(rule.styleSheet);
        if (rule.cssRules) each(rule.cssRules);
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = unquote(rule.style.getPropertyValue("font-family"));
        const src = rule.style.getPropertyValue("src");
        if (!families.has(family) || !/url\(/.test(src)) continue;
        out.push({
          family,
          src: src.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (_, _q, u) => `url("${new URL(u, base).href}")`),
          weight: rule.style.getPropertyValue("font-weight") || undefined,
          style: rule.style.getPropertyValue("font-style") || undefined,
          display: "swap",
        });
      } };
      each(rules);
    };
    for (const sheet of document.styleSheets) walk(sheet);
    return out;
  }

  const desk = DESK ? `<a href="mailto:${esc(DESK)}">${esc(DESK)}</a>` : "the desk";
  function unavailable(text = `Email the desk at ${desk}.`) {
    return `<div class="flow"><h1 tabindex="-1">Booking online is unavailable</h1><p>${text}</p><a class="btn quiet" href="/">← Back to the site</a></div>`;
  }
  // A link's page opened without the link: nothing is down, the page opens from an email.
  function fromEmail(heading, email) {
    return `<div class="flow"><h1 tabindex="-1">${heading}</h1><p>This page opens from the link in your ${email}.</p><a class="btn quiet" href="/">← Back to the site</a></div>`;
  }
  const problem = (text) => `<div class="alert x" role="alert"><p>${text}</p></div>`;
  const notice = (text) => `<div class="alert" role="status"><p>${text}</p></div>`;
  const FREED = "Nothing was paid, and the time you chose is free again.";
  const rows = (pairs) => `<div class="sum">${pairs.filter(Boolean).map(([a, b]) => `<div><span>${a}</span><span class="num">${b}</span></div>`).join("")}</div>`;

  // What a booking from /status, /manage or /desk says about time and money.
  function bookingRows(data) {
    const m = (cents) => money(cents, data.currency);
    const deposit = data.deposit && {
      held: `${m(data.deposit.amount)} held`,
      captured: `${m(data.deposit.amount)} paid`,
      released: `${m(data.deposit.amount)} hold released`,
    }[data.deposit.state];
    const balance = data.balance && {
      due: `${m(data.balance.amount)} on ${dateLabel(data.balance.due.slice(0, 10))}`,
      paid: `${m(data.balance.amount)} paid`,
      failed: `${m(data.balance.amount)} not yet paid`,
    }[data.balance.state];
    const paidWith = data.paid_with ? ` · ${PAID_WITH[data.paid_with] ?? data.paid_with}` : "";
    return rows([
      ["When", `${esc(whenLabel(data.start))}${data.hours ? `, ${data.hours} h` : ""}`],
      deposit ? ["Deposit", esc(deposit + paidWith)] : ["Paid", data.amount ? esc(m(data.amount) + paidWith) : "Free"],
      balance && ["Balance", esc(balance)],
    ]);
  }

  // The booking page: choose a service, a time, then the details; paid services go on to Stripe.
  async function bookPage(booking) {
    const params = new URLSearchParams(location.search);
    let note = "";
    if (params.get("released") && params.get("booking")) {
      await call(booking, "/holds/release", { booking: params.get("booking") });
      history.replaceState(null, "", location.pathname);
      note = notice(FREED);
    }
    // Hourly services first, as the confirmed design lists them.
    const services = Object.entries(booking.services).sort(([, a], [, b]) => (b.per_hour ? 1 : 0) - (a.per_hour ? 1 : 0));
    const state = { id: services[0][0], hours: 0, date: "", start: "", days: [], pay: "deposit" };
    const service = () => booking.services[state.id];
    const m = (cents) => money(cents, booking.currency);
    const total = () => (service().per_hour ? service().per_hour * state.hours : service().price);
    const paid = () => Boolean(service().per_hour || service().price);
    // A deposit only when the start leaves time to charge the balance before it.
    const deposit = () => {
      const d = service().deposit;
      if (!d || !paid() || !state.start) return null;
      const balanceDate = daysBefore(state.start.slice(0, 10), d.balance_days_before);
      return balanceDate > new Date().toISOString().slice(0, 10) ? { ...d, now: Math.round((total() * d.percent) / 100), balanceDate } : null;
    };
    const pay = () => (deposit() ? state.pay : "full");
    const steps = (at) => {
      const all = paid() ? ["Choose", "When", "Who", "Pay", "Confirmed"] : ["Choose", "When", "Who", "Confirmed"];
      const i = all.indexOf(at);
      return `<div class="steps">${all.map((x, j) => `<span class="${j === i ? "on" : j < i ? "past" : ""}">${x}</span>`).join("")}</div>`;
    };
    const price = (s) => (s.per_hour ? `${m(s.per_hour)} an hour · ${s.hours.min}-hour minimum` : s.price ? m(s.price) : `${s.minutes} minutes by phone · free`);

    function choose(message = "") {
      show(`<div class="flow">${steps("Choose")}${message}<h1 tabindex="-1">Choose a service</h1>
  <div class="cards">${services.map(([id, s]) => `<button class="card" data-id="${esc(id)}" aria-pressed="${id === state.id}"><b>${esc(s.name)}</b><span>${esc(price(s))}</span></button>`).join("")}
  <a class="card" href="mailto:${esc(DESK)}?subject=Secured%20ride%2C%20guards%20or%20patrol"><b>Secured ride · Guards · Patrol</b><span>Call, text or email the desk</span></a></div>
  <button class="btn go wide" data-go>Choose a time</button></div>`);
      view.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => { state.id = b.dataset.id; choose(); }));
      view.querySelector("[data-go]").addEventListener("click", () => { state.hours = service().hours?.min ?? 0; state.date = state.start = ""; when(); });
    }

    function payChoice() {
      const d = deposit();
      if (!paid()) return rows([[`${service().minutes} minutes by phone`, "<b>Free</b>"]]);
      const lead = service().per_hour ? [`${state.hours} h × ${m(service().per_hour)}`, `<b>${m(total())}</b>`] : [esc(service().name), `<b>${m(total())}</b>`];
      if (!d) {
        return rows([lead]) + (service().deposit && state.start ? `<p class="note">Paid in full: the start is less than ${service().deposit.balance_days_before} days away.</p>` : "");
      }
      const option = (value, title, detail) => `<label class="card"><input type="radio" name="pay" value="${value}"${state.pay === value ? " checked" : ""}><b>${title}</b><span>${detail}</span></label>`;
      return rows([lead]) + `<fieldset class="cards pay"><legend class="lab"><span>How to pay</span></legend>
  ${option("deposit", `${m(d.now)} now`, `Held on your card for ${d.hold_hours} hours, then kept; ${m(total() - d.now)} on ${dateLabel(d.balanceDate)}. Card, Apple Pay or Link.`)}
  ${option("full", `${m(total())} now`, "All at once. Card, Apple Pay, Link or USDC.")}</fieldset>`;
    }

    async function when(message = "") {
      const s = service();
      const hours = s.per_hour ? `&hours=${state.hours}` : "";
      const { status, data } = await call(booking, `/slots?service=${encodeURIComponent(state.id)}&from=${new Date().toISOString().slice(0, 10)}&days=${DAYS_SHOWN}${hours}`);
      if (status !== 200) return show(unavailable());
      if (!data.fresh) return show(unavailable());
      state.days = data.days.filter((d) => d.slots.some((t) => t.open));
      if (!state.days.some((d) => d.date === state.date)) state.date = state.days[0]?.date ?? "";
      const day = state.days.find((d) => d.date === state.date);
      if (!day?.slots.some((t) => t.open && t.start === state.start)) state.start = "";
      show(`<div class="flow">${steps("When")}${message}<span class="eye">${esc(s.name)}</span><h1 tabindex="-1">Choose a time</h1>
  ${slotPicker(booking, state.days, state.date, state.start)}${s.per_hour ? hourStepper(s.hours, state.hours) : ""}${payChoice()}
  <button class="btn go wide" data-go${state.start ? "" : " disabled"}>Continue</button><button class="btn quiet" data-back>← Back</button></div>`);
      view.querySelectorAll("[data-date]").forEach((b) => b.addEventListener("click", () => { state.date = b.dataset.date; state.start = ""; when(); }));
      view.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => { state.start = b.dataset.start; when(); }));
      view.querySelectorAll("[data-hours]").forEach((b) => b.addEventListener("click", () => { state.hours += Number(b.dataset.hours); when(); }));
      view.querySelectorAll("input[name=pay]").forEach((r) => r.addEventListener("change", () => { state.pay = r.value; }));
      view.querySelector("[data-go]").addEventListener("click", () => who());
      view.querySelector("[data-back]").addEventListener("click", () => choose());
    }

    // Stated before money is committed; the amounts come from the site's offer.
    const terms = () => {
      const { full_before_hours: h, late_percent: pct } = booking.cancel;
      return `Cancelling more than ${h} hours before: full refund. Within ${h} hours: ${pct === 50 ? "half" : `${pct}%`}. No-show: nothing.`;
    };

    function who(errors = {}, values = {}, message = "") {
      const s = service();
      const field = (name, label, { type = "text", auto = "", required = true, area = false } = {}) => {
        const err = errors[name] ? `<span class="err" id="err-${name}">${errors[name] === "required" ? "Please fill this in." : "Please check this."}</span>` : "";
        const attrs = `name="${name}" id="f-${name}"${auto ? ` autocomplete="${auto}"` : ""}${required ? " required" : ""}${errors[name] ? ` aria-invalid="true" aria-describedby="err-${name}"` : ""}`;
        const input = area ? `<textarea ${attrs}>${esc(values[name])}</textarea>` : `<input type="${type}" ${attrs} value="${esc(values[name])}">`;
        return `<label class="field" for="f-${name}"><span class="lab"><span>${esc(label)}</span>${required ? "" : "<span>Optional</span>"}</span>${input}${err}</label>`;
      };
      const own = Object.entries(s.fields || {}).map(([name, need]) =>
        field(name, s.labels?.[name] ?? name[0].toUpperCase() + name.slice(1).replace(/_/g, " "), { required: need === "required", area: name === "about" }),
      ).join("");
      show(`<div class="flow">${steps("Who")}${message}<span class="eye">${esc(s.name)} · ${esc(whenLabel(state.start))}</span><h1 tabindex="-1">Your details</h1>
  <form class="form">${field("name", "Your name", { auto: "name" })}${field("email", "Email", { type: "email", auto: "email" })}${field("mobile", "Mobile", { type: "tel", auto: "tel" })}${own}
  ${paid() ? `<p class="note">${esc(terms())}</p>` : ""}<button class="btn go wide" type="submit">${paid() ? "Continue to pay" : "Confirm"}</button></form><button class="btn quiet" data-back>← Back</button></div>`);
      view.querySelector("[data-back]").addEventListener("click", () => when());
      // One hold per press: a second press while the first is in flight would be refused as a taken time.
      view.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        const go = event.target.querySelector("[type=submit]");
        if (go.disabled) return;
        go.disabled = true;
        hold(Object.fromEntries(new FormData(event.target)));
      });
    }

    async function hold(values) {
      const { name, email, mobile, ...fields } = values;
      const body = { service: state.id, start: state.start, name, email, mobile, fields };
      if (service().per_hour) body.hours = state.hours;
      if (service().deposit && paid()) body.pay = pay();
      body.checkout = "elements";
      const { status, data } = await call(booking, "/holds", body);
      if (status === 201 && data.status === "holding" && data.checkout?.client_secret) return payHere(data, values);
      if (status === 201 && data.status === "holding" && /^https:/.test(data.checkout_url ?? "")) return location.assign(data.checkout_url);
      if (status === 201 && data.status === "confirmed") return confirmed(values);
      if (status === 409) return when(problem("That time was just booked by someone else. Please choose another."));
      if (status === 422 && data.fields?.pay) { state.pay = "full"; return when(problem("This time can only be paid in full.")); }
      if (status === 422) return who(data.fields || {}, values, problem("Please check the fields marked below."));
      if (status === 503 && data.error === "calendar_unavailable") return show(unavailable());
      if (status === 503) return show(unavailable());
      if (status === 429) return who({}, values, problem(`Too many bookings were started from here. Please try again later, or email the desk at ${desk}.`));
      return who({}, values, problem(`Something went wrong. Please try again, or email the desk at ${desk}.`));
    }

    // Paying in this page: the summary, the Pay button, its errors and its waiting state are the
    // site's own; only the card fields are Stripe's. Paying returns to the done page.
    async function payHere(held, values) {
      const due = held.due_now ?? held.amount;
      show(`<div class="flow">${steps("Pay")}<span class="eye">${esc(service().name)} · ${esc(whenLabel(state.start))}</span><h1 tabindex="-1">Pay ${esc(m(due))}</h1>
  <form class="form"><div data-stripe></div><div data-problem></div><button class="btn go wide" type="submit" disabled>Pay</button></form>
  <button class="btn quiet" data-back>← Back</button></div>`);
      const go = view.querySelector("[type=submit]");
      const back = view.querySelector("[data-back]");
      const said = view.querySelector("[data-problem]");
      let checkout = null, fields = null, left = false;
      // Leaving frees the time, unless a payment already went through: the service then keeps the hold.
      const leave = async (then) => {
        if (left) return;
        left = true;
        fields?.destroy();
        const { data } = await call(booking, "/holds/release", { booking: held.booking });
        if (data.status === "holding") return show(unavailable(`Your payment is going through. Stripe emails your receipt; if none has arrived within the hour, email the desk at ${desk} before paying again.`));
        then();
      };
      const failed = () => leave(() => show(unavailable(`The payment form did not load. Nothing was paid. Please try again, or email the desk at ${desk}.`)));
      const busy = (on) => {
        go.disabled = back.disabled = on;
        go.textContent = on ? "Paying…" : "Pay";
        if (on) go.setAttribute("aria-busy", "true");
        else go.removeAttribute("aria-busy");
      };
      back.addEventListener("click", () => leave(() => who({}, values, notice(FREED))));
      view.querySelector("form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!checkout || go.disabled) return;
        busy(true);
        said.innerHTML = "";
        try {
          // On success Stripe goes on to the done page; only a refusal comes back.
          const result = await checkout.confirm();
          if (result.type !== "error") return;
          said.innerHTML = problem(esc(result.error.message));
        } catch {
          said.innerHTML = problem(`Something went wrong. Please try again, or email the desk at ${desk}.`);
        }
        busy(false);
      });
      // Back can come while Stripe.js loads; nothing opens after it.
      try {
        const Stripe = await stripeJs();
        if (left) return;
        const opened = await Stripe(held.checkout.publishable_key, { stripeAccount: held.checkout.account })
          .initCheckout({ fetchClientSecret: async () => held.checkout.client_secret, elementsOptions: siteLook() });
        if (left) return;
        checkout = opened;
        fields = checkout.createPaymentElement();
        fields.on("ready", () => { if (!left) go.disabled = false; });
        fields.on("loaderror", failed);
        fields.mount(view.querySelector("[data-stripe]"));
      } catch {
        failed();
      }
    }

    function confirmed(values) {
      show(`<div class="flow">${steps("Confirmed")}<span class="state"><i></i>Confirmed</span><h1 tabindex="-1">${esc(service().name)}</h1>
  <p>${esc(whenLabel(state.start))}. Confirmation sent to ${esc(values.email)}.</p><a class="btn quiet" href="/">← Back to the site</a></div>`);
    }

    // The map's "Request protection for this trip": trips abroad are quoted by the desk.
    function trip(place) {
      const subject = encodeURIComponent(`Protection in ${place}`);
      show(`<div class="flow"><span class="eye">Protection in ${esc(place)}</span><h1 tabindex="-1">Trip request</h1>
  <p>Tell the desk your dates and who travels. They reply with a plan, a price and a link to pay.</p>
  <a class="btn go wide" href="mailto:${esc(DESK)}?subject=${subject}">Email the desk</a><a class="btn quiet" href="${esc(booking.pages.book)}">← All services</a></div>`);
    }

    const to = params.get("to");
    if (to) return trip(to.slice(0, 80));
    const asked = params.get("service");
    if (asked && Object.hasOwn(booking.services, asked)) {
      state.id = asked;
      state.hours = service().hours?.min ?? 0;
      return when();
    }
    choose(note);
  }

  // Dates, then the times of the chosen date; a closed time stays visible but cannot be picked.
  function slotPicker(booking, days, date, start) {
    if (!days.length) return `<p>No time is open in the next ${DAYS_SHOWN} days. Email the desk at ${desk}.</p>`;
    const day = days.find((d) => d.date === date);
    const dates = days.map((d) => { const l = dayLabel(d.date); return `<button class="chip" data-date="${d.date}" aria-pressed="${d.date === date}"><small>${l.weekday}</small>${l.day} ${l.month}</button>`; }).join("");
    const times = day ? day.slots.map((t) => `<button class="chip" data-start="${esc(t.start)}" aria-pressed="${t.start === start}"${t.open ? "" : " disabled"}>${esc(t.time)}</button>`).join("") : "";
    return `<div><div class="lab"><span>Date</span></div><div class="dates">${dates}</div></div><div><div class="lab"><span>Start · ${esc(booking.timezone.split("/").pop().replace("_", " "))} time</span></div><div class="slots">${times}</div></div>`;
  }

  function hourStepper(limits, hours) {
    return `<div class="seat"><span class="lab" style="margin:0"><span>Hours</span></span><span class="stepper"><button data-hours="-1" aria-label="One hour fewer"${hours <= limits.min ? " disabled" : ""}>−</button><output class="num" aria-live="polite">${hours}</output><button data-hours="1" aria-label="One hour more"${hours >= limits.max ? " disabled" : ""}>+</button></span></div>`;
  }

  // After Stripe: wait for the payment notice, then say what was booked.
  async function donePage(booking) {
    const params = new URLSearchParams(location.search);
    const id = params.get("booking"), session = params.get("session");
    // Back from paying a balance through the emailed link. Anyone can type this address, and it
    // brings no session for /status to check, so it can never say the balance is paid.
    if (id && params.get("balance") === "paid" && !session) return notConfirmed("This page cannot confirm a balance payment.");
    if (!id || !session) return show(unavailable());
    const started = Date.now();
    show(`<div class="flow"><span class="state t"><i></i>Confirming</span><h1 tabindex="-1" role="status">Confirming your payment</h1></div>`);
    for (;;) {
      const { status, data } = await call(booking, `/status?booking=${encodeURIComponent(id)}&session=${encodeURIComponent(session)}`);
      if (status === 200 && data.status === "confirmed") {
        return show(`<div class="flow"><span class="state"><i></i>Confirmed</span><h1 tabindex="-1">${esc(data.service_name)}</h1>
  ${bookingRows(data)}<p>Confirmation sent to ${esc(data.email)}.</p><a class="btn quiet" href="/">← Back to the site</a></div>`);
      }
      if (status === 200 && data.status === "expired") {
        return show(`<div class="flow"><span class="state x"><i></i>Not booked</span><h1 tabindex="-1">The time was released</h1><p>The payment did not finish in time, so nothing was booked.</p><a class="btn go" href="${esc(booking.pages.book)}">Book again</a></div>`);
      }
      // The booking and session never match: asking again will not change that.
      if (status === 404) return notConfirmed("This page cannot find your payment.");
      if (Date.now() - started > 60000) return notConfirmed("Stripe has not told us about your payment yet.");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  function notConfirmed(why) {
    show(`<div class="flow"><span class="state t"><i></i>Not confirmed yet</span><h1 tabindex="-1">Your payment is not confirmed yet</h1><p>${why}</p>
  <p>If you paid, Stripe emails your receipt. If none has arrived within the hour, email the desk at ${desk} before paying again.</p><a class="btn quiet" href="/">← Back to the site</a></div>`);
  }

  // The manage link: the token sits in the address's fragment, so no server ever logs it.
  async function managePage(booking) {
    const token = location.hash.slice(1);
    if (!token) return show(fromEmail("Manage your booking", "confirmation email"));
    let { status, data } = await call(booking, "/manage", { token });
    if (status === 404) return show(`<div class="flow"><h1 tabindex="-1">This link no longer works</h1><p>Email the desk at ${desk}.</p></div>`);
    if (status !== 200) return show(unavailable());
    const m = (cents) => money(cents, data.currency);
    const refundText = (c) => (c.refund ? `You get back ${m(c.refund)}${c.rule === "late" ? ", because it is less than a day before the start" : ""}.` : "Nothing is refunded.");

    function overview(message = "") {
      const state = { cancelled: "Cancelled", declined: "Declined by the desk" }[data.status];
      const actions = [
        data.move?.allowed && `<button class="btn" data-move>Move to another time</button>`,
        data.cancel?.allowed && `<button class="btn" data-cancel>Cancel this booking</button>`,
      ].filter(Boolean).join("");
      const after = actions ? `<div class="btns">${actions}</div>` : state ? "" : `<p class="note">This booking can no longer be changed online. Email the desk at ${desk}.</p>`;
      show(`<div class="flow">${message}<span class="state${state ? " x" : ""}"><i></i>${state ?? "Confirmed"}</span><h1 tabindex="-1">${esc(data.service_name)}</h1>${bookingRows(data)}${after}</div>`);
      view.querySelector("[data-cancel]")?.addEventListener("click", () => confirmCancel());
      view.querySelector("[data-move]")?.addEventListener("click", () => move());
    }

    function confirmCancel(message = "") {
      show(`<div class="flow">${message}<span class="eye">${esc(data.service_name)} · ${esc(whenLabel(data.start))}</span><h1 tabindex="-1">Cancel this booking?</h1>
  <p>${refundText(data.cancel)}</p><div class="btns"><button class="btn go" data-yes>Cancel the booking</button><button class="btn quiet" data-no>Keep it</button></div></div>`);
      view.querySelector("[data-no]").addEventListener("click", () => overview());
      view.querySelector("[data-yes]").addEventListener("click", async () => {
        const r = await call(booking, "/manage/cancel", { token, refund: data.cancel.refund });
        if (r.status === 200) {
          data = { ...data, status: "cancelled", cancel: { allowed: false }, move: { allowed: false } };
          return overview(notice(`Cancelled. ${r.data.refund ? `${m(r.data.refund)} is on its way back.` : "Nothing was refunded."}`));
        }
        if (r.status === 409 && r.data.error === "refund_changed") {
          data.cancel = r.data.cancel;
          return confirmCancel(problem("The refund changed while this page was open."));
        }
        if (r.status === 409) return overview(problem("This booking can no longer be cancelled online."));
        return confirmCancel(problem(`Something went wrong. Please try again, or email the desk at ${desk}.`));
      });
    }

    // Any open time of the same length, until the line the confirmation names; no money moves.
    async function move(message = "", pick = { date: "", start: "" }) {
      const r = await call(booking, "/manage/slots", { token, from: new Date().toISOString().slice(0, 10), days: DAYS_SHOWN });
      if (r.status !== 200 || !r.data.fresh) return overview(problem("Open times cannot be read right now. Please try again later."));
      const days = r.data.days.filter((d) => d.slots.some((t) => t.open));
      if (!days.some((d) => d.date === pick.date)) pick.date = days[0]?.date ?? "";
      show(`<div class="flow">${message}<span class="eye">${esc(data.service_name)} · now ${esc(whenLabel(data.start))}</span><h1 tabindex="-1">Choose a new time</h1>
  ${slotPicker(booking, days, pick.date, pick.start)}<p class="note">Moves are free until ${esc(whenLabel(data.move.until))}.</p>
  <button class="btn go wide" data-go${pick.start ? "" : " disabled"}>Move the booking</button><button class="btn quiet" data-back>← Keep the time</button></div>`);
      view.querySelectorAll("[data-date]").forEach((b) => b.addEventListener("click", () => move("", { date: b.dataset.date, start: "" })));
      view.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => move("", { ...pick, start: b.dataset.start })));
      view.querySelector("[data-back]").addEventListener("click", () => overview());
      view.querySelector("[data-go]").addEventListener("click", async () => {
        const moved = await call(booking, "/manage/move", { token, start: pick.start });
        if (moved.status === 200) { data = moved.data; return overview(notice(`Moved to ${esc(whenLabel(data.start))}.`)); }
        if (moved.status === 409 && moved.data.error === "slot_taken") return move(problem("That time was just booked by someone else. Please choose another."), { date: pick.date, start: "" });
        if (moved.status === 409) return overview(problem("This booking can no longer be moved online."));
        return move(problem(`Something went wrong. Please try again, or email the desk at ${desk}.`), pick);
      });
    }

    overview();
  }

  // The desk's link from a booking email: the booking, and declining it with a reason the client reads.
  async function deskPage(booking) {
    const token = location.hash.slice(1);
    if (!token) return show(fromEmail("Booking desk", "booking notification email"));
    const { status, data } = await call(booking, "/desk", { token });
    if (status === 404) return show(`<div class="flow"><h1 tabindex="-1">This link no longer works</h1></div>`);
    if (status !== 200) return show(unavailable());
    const m = (cents) => money(cents, data.currency);
    const details = rows([["Client", esc(data.name)], ["Email", esc(data.email)], ["Mobile", esc(data.mobile)], ...Object.entries(data.fields || {}).map(([k, v]) => [esc(k[0].toUpperCase() + k.slice(1)), esc(v)])]);

    function overview(message = "") {
      const state = { cancelled: "Cancelled", declined: "Declined" }[data.status];
      const decline = data.decline?.allowed
        ? `<form class="form" data-decline><label class="field" for="f-reason"><span class="lab"><span>Reason, sent to the client</span></span><textarea id="f-reason" name="reason" required maxlength="1000"></textarea></label>
  <p class="note">${data.decline.how === "release" ? `The ${m(data.decline.returns)} hold is released.` : `${m(data.decline.returns)} is refunded.`}</p><button class="btn go" type="submit">Decline the booking</button></form>`
        : "";
      show(`<div class="flow">${message}<span class="state${state ? " x" : ""}"><i></i>${state ?? "Booked"}</span><h1 tabindex="-1">${esc(data.service_name)}</h1>${bookingRows(data)}${details}${decline}</div>`);
      view.querySelector("[data-decline]")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const r = await call(booking, "/desk/decline", { token, reason: new FormData(event.target).get("reason") });
        if (r.status === 200) {
          data.status = "declined";
          data.decline = { allowed: false };
          return overview(notice(`Declined. ${m(r.data.returns)} goes back to the client.`));
        }
        if (r.status === 409) { data.decline = { allowed: false }; return overview(problem("The booking has started, so it can no longer be declined here.")); }
        return overview(problem("Something went wrong. Please try again."));
      });
    }

    overview();
  }

  const booking = await offer();
  if (!booking) return;
  ({ book: bookPage, done: donePage, manage: managePage, desk: deskPage })[page]?.(booking);
}

class MossBooking extends HTMLElement {
  connectedCallback() {
    if (this.started) return;
    this.started = true;
    const a = (name) => this.getAttribute(name) ?? "";
    mount(this, a("page") || "book", a("desk"), a("endpoint"));
  }
}

customElements.define("moss-booking", MossBooking);
