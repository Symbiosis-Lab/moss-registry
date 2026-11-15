// <moss-booking>: choosing, paying for, moving and cancelling a booking, on the page that
// places it. The element's children stay until the offer loads, so they are what shows with
// no script or no offer. Reads the offer the site publishes; talks to the service named there.

// The fewest and most of an add-on, a missing range being 0 to 1.
const qtyOf = (add) => add.qty ?? { min: 0, max: 1 };

// Stripe's largest single charge, in the currency's smallest unit.
const MAX_CHARGE = 99_999_999;

// A choice's options, cheapest first: moss publishes a table's keys sorted, so the order they were written in is lost.
const optionsOf = (s) => Object.entries(s.choice.options).sort(([, a], [, b]) => a.price - b.price);

// Booked by the hour: a rate of its own, or a choice with no fixed length. The booking service's own rule.
const hourly = (s) => s.per_hour !== undefined || Boolean(s.choice && s.minutes === undefined);

// The deposit held now, rounded down, as the booking service charges it.
function depositOf(total, percent) {
  return Math.floor((total * percent) / 100);
}

// A deposit is offered only when the start is at least `days` whole days after `now` (both in ms),
// so the balance can be charged before it. The booking service decides by the same rule.
function depositAllowed(start, now, days) {
  return start - now >= days * 864e5;
}

// What a booking costs: the service's rate, plus the choice, plus each add-on's quantity times its
// unit price (per hour booked, or once). null where the service refuses the selection. The service
// computes the same sum and its own answer is the one that charges; the shared vectors in
// test/price-vectors.json fail if either side changes alone.
function totalOf(s, hours, { choice, add_ons } = {}) {
  const byHour = hourly(s);
  if (byHour && !(Number.isInteger(hours) && hours >= s.hours.min && hours <= s.hours.max)) return null;
  const unit = (x) => (x.per === "booking" ? x.price : x.price * hours);
  let total = byHour ? (s.per_hour ?? 0) * hours : s.price;
  if (s.choice) {
    if (typeof choice !== "string" || !Object.hasOwn(s.choice.options, choice)) return null;
    total += unit(s.choice.options[choice]);
  } else if (choice !== undefined) return null;
  const given = add_ons === undefined ? {} : add_ons;
  const extras = s.add_ons ?? {};
  if (!given || typeof given !== "object" || Array.isArray(given) || Object.keys(given).some((id) => !Object.hasOwn(extras, id))) return null;
  for (const [id, add] of Object.entries(extras)) {
    const { min, max } = qtyOf(add);
    const qty = given[id] === undefined ? min : given[id];
    if (!Number.isInteger(qty) || qty < min || qty > max) return null;
    total += qty * unit(add);
  }
  return total > MAX_CHARGE ? null : total;
}

// Every word a visitor reads. The offer's `words` replaces any of them; `{name}` is filled in.
// A page in Simplified Chinese (the language the editor is translated into) gets `zh`; any other page English.
const WORDS = {
  en: {
    unavailable: "Booking online is unavailable", email_desk: "Email the desk at {desk}.", the_desk: "the desk",
    back_to_site: "← Back to the site", back: "← Back", from_email: "This page opens from the link in your {email}.",
    confirmation_email: "confirmation email", notification_email: "booking notification email",
    manage_title: "Manage your booking", desk_title: "Booking desk", link_dead: "This link no longer works",
    failed: "Something went wrong. Please try again, or email the desk at {desk}.", failed_desk: "Something went wrong. Please try again.",
    freed: "Nothing was paid, and the time you chose is free again.",
    step_choose: "Choose", step_book: "Book", step_pay: "Pay", step_confirmed: "Confirmed",
    choose_title: "Choose a service", continue: "Continue", ask_desk: "Ask the desk",
    an_hour: "{amount} an hour", hour_minimum: "{amount} an hour · {hours}-hour minimum", from: "From {rate}",
    minutes_free: "{minutes} minutes · free", minutes: "{minutes} minutes",
    when: "When", when_at: "{date}, {time}", hours_short: "{hours} h", total: "Total", free: "Free",
    deposit: "Deposit", paid: "Paid", balance: "Balance", held: "{amount} held", captured: "{amount} paid",
    released: "{amount} hold released", balance_due: "{amount} on {date}", balance_paid: "{amount} paid", balance_failed: "{amount} not yet paid",
    full_only: "Paid in full: the start is less than {days} days away.", how_to_pay: "How to pay", now: "{amount} now",
    deposit_detail: "Held on your card for {hours} hours, then kept; {rest} on {date}.", full_detail: "All at once.",
    your_name: "Your name", email: "Email", mobile: "Mobile", optional: "Optional",
    fill_in: "Please fill this in.", check_this: "Please check this.",
    hours: "Hours", one_hour: "One hour", one_of: "One {name}", fewer: "{noun} fewer", more: "{noun} more",
    date: "Date", start_zone: "Start · {zone} time", no_times: "No time is open in the next {days} days. Email the desk at {desk}.",
    pay: "Pay", pay_amount: "Pay {amount}", confirm: "Confirm", price_changed: "The total is now {amount}.",
    terms: "Cancelling more than {hours} hours before: full refund. Within {hours} hours: {percent}%. No-show: nothing.",
    taken: "That time was just booked by someone else. Please choose another.",
    full_required: "This time can only be paid in full.", check_fields: "Please check the fields marked below.",
    check_choices: "Please check your choices.",
    too_many: "Too many bookings were started from here. Please try again later, or email the desk at {desk}.",
    going_through: "Your payment is going through. Stripe emails your receipt; if none has arrived within the hour, email the desk at {desk} before paying again.",
    form_failed: "The payment form did not load. Nothing was paid. Please try again, or email the desk at {desk}.",
    sent_to: "Confirmation sent to {email}.", confirmed: "Confirmed",
    confirming: "Confirming", confirming_title: "Confirming your payment",
    not_booked: "Not booked", released_title: "The time was released",
    released_text: "The payment did not finish in time, so nothing was booked.", book_again: "Book again",
    no_balance_proof: "This page cannot confirm a balance payment.", not_found: "This page cannot find your payment.",
    stripe_silent: "Stripe has not told us about your payment yet.",
    not_confirmed: "Not confirmed yet", not_confirmed_title: "Your payment is not confirmed yet",
    receipt: "If you paid, Stripe emails your receipt. If none has arrived within the hour, email the desk at {desk} before paying again.",
    refund: "You get back {amount}.", refund_late: "You get back {amount}, because the full refund ended {when}.", no_refund: "Nothing is refunded.",
    cancelled: "Cancelled", declined_by_desk: "Declined by the desk", declined: "Declined", booked: "Booked",
    move: "Move to another time", cancel: "Cancel this booking", locked: "This booking can no longer be changed online. Email the desk at {desk}.",
    cancel_title: "Cancel this booking?", cancel_yes: "Cancel the booking", cancel_no: "Keep it",
    cancelled_refund: "Cancelled. {amount} is on its way back.", cancelled_none: "Cancelled. Nothing was refunded.",
    refund_changed: "The refund changed while this page was open.", no_cancel: "This booking can no longer be cancelled online.",
    times_unreadable: "Open times cannot be read right now. Please try again later.",
    now_at: "now {when}", move_title: "Choose a new time", moves_free: "Moves are free until {when}.",
    move_go: "Move the booking", keep_time: "← Keep the time", moved: "Moved to {when}.", no_move: "This booking can no longer be moved online.",
    client: "Client", reason: "Reason, sent to the client", hold_released: "The {amount} hold is released.",
    refunded: "{amount} is refunded.", decline_go: "Decline the booking", declined_done: "Declined. {amount} goes back to the client.",
    started: "The booking has started, so it can no longer be declined here.",
  },
  zh: {
    unavailable: "暂时无法在线预约", email_desk: "请发邮件至 {desk}。", the_desk: "前台",
    back_to_site: "← 返回网站", back: "← 返回", from_email: "请从{email}中的链接打开此页。",
    confirmation_email: "确认邮件", notification_email: "预约通知邮件",
    manage_title: "管理预约", desk_title: "预约前台", link_dead: "此链接已失效",
    failed: "出了点问题。请重试，或发邮件至 {desk}。", failed_desk: "出了点问题。请重试。",
    freed: "未付任何款项，你选的时间已重新开放。",
    step_choose: "选择", step_book: "预约", step_pay: "付款", step_confirmed: "已确认",
    choose_title: "选择服务", continue: "继续", ask_desk: "联系前台",
    an_hour: "每小时 {amount}", hour_minimum: "每小时 {amount} · 至少 {hours} 小时", from: "{rate} 起",
    minutes_free: "{minutes} 分钟 · 免费", minutes: "{minutes} 分钟",
    when: "时间", when_at: "{date} {time}", hours_short: "{hours} 小时", total: "合计", free: "免费",
    deposit: "定金", paid: "已付", balance: "尾款", held: "已冻结 {amount}", captured: "已付 {amount}",
    released: "已解冻 {amount}", balance_due: "{date} 付 {amount}", balance_paid: "已付 {amount}", balance_failed: "{amount} 尚未付清",
    full_only: "需全额付款：距开始不足 {days} 天。", how_to_pay: "付款方式", now: "现在付 {amount}",
    deposit_detail: "在你的卡上冻结 {hours} 小时后扣款；{date} 付余下的 {rest}。", full_detail: "一次付清。",
    your_name: "姓名", email: "邮箱", mobile: "手机", optional: "选填",
    fill_in: "请填写此项。", check_this: "请检查此项。",
    hours: "时长", one_hour: "一小时", one_of: "一位{name}", fewer: "减少{noun}", more: "增加{noun}",
    date: "日期", start_zone: "开始时间 · {zone}", no_times: "未来 {days} 天没有可约时间。请发邮件至 {desk}。",
    pay: "付款", pay_amount: "付款 {amount}", confirm: "确认", price_changed: "合计现为 {amount}。",
    terms: "开始前 {hours} 小时以上取消：全额退款。{hours} 小时内取消：退 {percent}%。未到场：不退款。",
    taken: "这个时间刚被别人约走了。请另选一个。",
    full_required: "这个时间只能全额付款。", check_fields: "请检查下面标出的项。",
    check_choices: "请检查你的选择。",
    too_many: "从这里发起的预约过多。请稍后再试，或发邮件至 {desk}。",
    going_through: "你的付款正在处理。Stripe 会发收据给你；一小时内未收到，请先发邮件至 {desk}，不要重复付款。",
    form_failed: "付款表单未能加载，未付任何款项。请重试，或发邮件至 {desk}。",
    sent_to: "确认邮件已发至 {email}。", confirmed: "已确认",
    confirming: "确认中", confirming_title: "正在确认你的付款",
    not_booked: "未预约", released_title: "该时间已释放",
    released_text: "付款未在时限内完成，因此没有预约。", book_again: "重新预约",
    no_balance_proof: "此页无法确认尾款付款。", not_found: "此页找不到你的付款。",
    stripe_silent: "Stripe 尚未通知我们你的付款。",
    not_confirmed: "尚未确认", not_confirmed_title: "你的付款尚未确认",
    receipt: "如果你已付款，Stripe 会发收据给你。一小时内未收到，请先发邮件至 {desk}，不要重复付款。",
    refund: "你将拿回 {amount}。", refund_late: "你将拿回 {amount}，因为全额退款已于 {when} 截止。", no_refund: "不退款。",
    cancelled: "已取消", declined_by_desk: "前台已拒绝", declined: "已拒绝", booked: "已预约",
    move: "改到其他时间", cancel: "取消预约", locked: "此预约已不能在线更改。请发邮件至 {desk}。",
    cancel_title: "取消此预约？", cancel_yes: "取消预约", cancel_no: "保留",
    cancelled_refund: "已取消。{amount} 正在退回。", cancelled_none: "已取消。未退款。",
    refund_changed: "此页打开期间退款金额有变。", no_cancel: "此预约已不能在线取消。",
    times_unreadable: "暂时读不到可约时间。请稍后再试。",
    now_at: "现为 {when}", move_title: "选择新时间", moves_free: "{when} 前改期免费。",
    move_go: "改期", keep_time: "← 保留原时间", moved: "已改到 {when}。", no_move: "此预约已不能在线改期。",
    client: "客户", reason: "原因（会发给客户）", hold_released: "已解冻 {amount}。",
    refunded: "已退款 {amount}。", decline_go: "拒绝预约", declined_done: "已拒绝。{amount} 退回给客户。",
    started: "预约已开始，不能在此拒绝。",
  },
};

// Markup is built only by `h`: every value put into it is escaped, except markup `h` made itself.
class Markup { constructor(text) { this.text = text; } toString() { return this.text; } }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const part = (v) => (v instanceof Markup ? v.text : Array.isArray(v) ? v.map(part).join("") : v == null || v === false ? "" : esc(v));
const h = (strings, ...values) => new Markup(strings.reduce((out, s, i) => out + part(values[i - 1]) + s));

// The hosted checkout a visitor may be sent to: Stripe's, never any address the answer names.
const atCheckout = (address) => { try { return new URL(address).origin === "https://checkout.stripe.com"; } catch { return false; } };

async function mount(view, page, DESK, ENDPOINT) {

  const DAYS_SHOWN = 14;
  const lang = document.documentElement.lang || undefined;
  let words = /^zh(-(CN|SG|Hans)\b|$)/i.test(lang ?? "") ? { ...WORDS.en, ...WORDS.zh } : WORDS.en;
  const say = (key, vars = {}) => new Markup(esc(words[key]).replace(/\{(\w+)\}/g, (all, name) => (name in vars ? part(vars[name]) : all)));

  const money = (amount, currency) => {
    const unit = new Intl.NumberFormat(lang, { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    const value = amount / 10 ** unit;
    return new Intl.NumberFormat(lang, { style: "currency", currency, minimumFractionDigits: Number.isInteger(value) ? 0 : unit }).format(value);
  };

  // A new screen starts at its top: one that begins above the page's scroll-padding (the room a
  // sticky site header takes) is brought back into view below it.
  const show = (markup) => {
    view.innerHTML = markup;
    const room = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    if (view.getBoundingClientRect().top < room) view.scrollIntoView({ block: "start" });
    view.querySelector("h1")?.focus({ preventScroll: true });
  };
  // The same screen drawn again: focus goes back to the control that had it, and the page does not move.
  const KEYED = ["data-id", "data-date", "data-start", "data-addon", "data-hours", "data-step", "name"];
  const keyOf = (el) => (view.contains(el) && el !== view
    ? [...KEYED, ...(el.type === "radio" ? ["value"] : [])].filter((a) => el.hasAttribute(a)).map((a) => [a, el.getAttribute(a)])
    : null);
  const find = (key) => view.querySelector(key.map(([a, v]) => `[${a}="${CSS.escape(v)}"]`).join("") || null);
  const redraw = (markup) => {
    const key = keyOf(document.activeElement);
    const y = scrollY;
    view.innerHTML = markup;
    if (key?.length) {
      // A step button that reached its limit is disabled: its other sign takes the focus.
      let target = find(key);
      if (target?.disabled) target = [...view.querySelectorAll(key.filter(([a]) => a !== "data-step").map(([a, v]) => `[${a}="${CSS.escape(v)}"]`).join(""))].find((b) => !b.disabled);
      target?.focus({ preventScroll: true });
    }
    if (scrollY !== y) scrollTo(scrollX, y);
  };

  // One request at a time. While it is out every control in the view is inert and the pressed button
  // turns a ring (moss-booking.css); the answer, or a throw, ends it.
  let waiting = false;
  for (const type of ["click", "submit", "change"]) {
    view.addEventListener(type, (event) => { if (waiting) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  }
  async function send(button, work) {
    if (waiting) return;
    waiting = true;
    button.setAttribute("aria-busy", "true");
    try {
      await work();
    } finally {
      waiting = false;
      button.removeAttribute("aria-busy");
    }
  }

  // The service's times carry the site's offset, so the wall-clock time is read off the text, never converted.
  const utcDay = (date) => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const dates = (options) => new Intl.DateTimeFormat(lang, { timeZone: "UTC", ...options });
  const WEEKDAY = dates({ weekday: "short" }), DAY = dates({ day: "numeric", month: "short" }), DATE = dates({ weekday: "short", day: "numeric", month: "short" });
  const dateLabel = (date) => DATE.format(utcDay(date));
  const whenLabel = (instant) => say("when_at", { date: dateLabel(instant.slice(0, 10)), time: instant.slice(11, 16) });
  const daysBefore = (date, days) => new Date(utcDay(date) - days * 864e5).toISOString().slice(0, 10);
  const today = () => new Date().toISOString().slice(0, 10);
  const PAID_WITH = { card: "card", link: "Link", apple_pay: "Apple Pay", crypto: "USDC" };
  const labelOf = (s, name) => s?.labels?.[name] ?? name[0].toUpperCase() + name.slice(1).replaceAll("_", " ");

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
      const [surface, text, text2, muted, accent, line2] = ["--surface", "--text", "--text-2", "--muted", "--accent", "--line-2"].map((t) => hex(t, bg));
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

  let desk;
  const unavailable = (text = say("email_desk", { desk })) =>
    h`<div class="flow"><h1 tabindex="-1">${say("unavailable")}</h1><p>${text}</p><a class="btn quiet" href="/">${say("back_to_site")}</a></div>`;
  // A link's page opened without the link: nothing is down, the page opens from an email.
  const fromEmail = (heading, email) =>
    h`<div class="flow"><h1 tabindex="-1">${say(heading)}</h1><p>${say("from_email", { email: say(email) })}</p><a class="btn quiet" href="/">${say("back_to_site")}</a></div>`;
  const problem = (text) => h`<div class="alert x" role="alert"><p>${text}</p></div>`;
  const notice = (text) => h`<div class="alert" role="status"><p>${text}</p></div>`;
  const rows = (pairs) => h`<div class="sum">${pairs.filter(Boolean).map(([a, b]) => h`<div><span>${a}</span><span class="num">${b}</span></div>`)}</div>`;

  // What a booking from /status, /manage or /desk says about time and money.
  function bookingRows(data) {
    const amount = (n) => money(n, data.currency);
    const paidWith = data.paid_with ? ` · ${PAID_WITH[data.paid_with] ?? data.paid_with}` : "";
    const deposit = data.deposit && say(data.deposit.state, { amount: amount(data.deposit.amount) });
    const balance = data.balance && say(`balance_${data.balance.state}`, { amount: amount(data.balance.amount), date: data.balance.due && dateLabel(data.balance.due.slice(0, 10)) });
    return rows([
      [say("when"), h`${whenLabel(data.start)}${data.hours ? h`, ${say("hours_short", { hours: data.hours })}` : ""}`],
      ...(data.selection ?? []),
      deposit ? [say("deposit"), h`${deposit}${paidWith}`] : [say("paid"), data.amount ? amount(data.amount) + paidWith : say("free")],
      balance && [say("balance"), balance],
    ]);
  }

  // Dates, then the times of the chosen date; a closed time stays visible but cannot be picked.
  function slotPicker(booking, days, date, start) {
    if (!days.length) return h`<p>${say("no_times", { days: DAYS_SHOWN, desk })}</p>`;
    const day = days.find((d) => d.date === date);
    const zone = booking.timezone.split("/").pop().replaceAll("_", " ");
    return h`<div><div class="lab"><span>${say("date")}</span></div><div class="dates">${days.map((d) =>
      h`<button class="chip" data-date="${d.date}" aria-pressed="${d.date === date}"><small>${WEEKDAY.format(utcDay(d.date))}</small>${DAY.format(utcDay(d.date))}</button>`)}</div></div>
  <div><div class="lab"><span>${say("start_zone", { zone })}</span></div><div class="slots">${(day?.slots ?? []).map((t) =>
      h`<button class="chip" data-start="${t.start}" aria-pressed="${t.start === start}"${t.open ? "" : h` disabled`}>${t.time}</button>`)}</div></div>`;
  }

  // A count the person raises or lowers within a range; `step` on each button is read by the page.
  function stepper(label, [attr, value], noun, count, { min, max }) {
    const sign = (step, word, off) => h`<button type="button" ${new Markup(attr)}="${value}" data-step="${step}" aria-label="${say(word, { noun })}"${off ? h` disabled` : ""}>${step < 0 ? "−" : "+"}</button>`;
    return h`<div class="seat"><span class="lab"><span>${label}</span></span><span class="stepper">${sign(-1, "fewer", count <= min)}<output class="num" aria-live="polite">${count}</output>${sign(1, "more", count >= max)}</span></div>`;
  }

  // The booking page: choose a service, book it on one screen (options, time, details, the total),
  // then pay; a service that costs nothing is confirmed on the booking screen.
  async function bookPage(booking) {
    const params = new URLSearchParams(location.search);
    let note = "";
    // Back from Stripe's hosted page unpaid: the service frees the time, unless the payment went through.
    if (params.get("released") && params.get("booking")) {
      await call(booking, "/holds/release", { booking: params.get("booking") });
      history.replaceState(null, "", location.pathname);
      note = notice(say("freed"));
    }
    // Services with hours first.
    const services = Object.entries(booking.services).sort(([, a], [, b]) => (b.hours ? 1 : 0) - (a.hours ? 1 : 0));
    const state = { id: services[0][0], hours: 0, date: "", start: "", days: [], pay: "deposit", choice: "", addOns: {}, values: {} };
    const service = () => booking.services[state.id];
    const amount = (n) => money(n, booking.currency);
    const total = () => totalOf(service(), state.hours, { choice: service().choice ? state.choice : undefined, add_ons: service().add_ons ? state.addOns : undefined });
    const paid = () => Boolean(hourly(service()) || service().price);
    // A service starts at its shortest booking, its first option and the fewest of each add-on.
    function begin(id) {
      const s = booking.services[id];
      Object.assign(state, {
        id, hours: s.hours?.min ?? 0, date: "", start: "",
        choice: s.choice ? optionsOf(s)[0][0] : "",
        addOns: Object.fromEntries(Object.entries(s.add_ons ?? {}).map(([k, a]) => [k, qtyOf(a).min])),
      });
    }
    const deposit = () => {
      const d = service().deposit;
      if (!d || !paid() || !state.start || !depositAllowed(Date.parse(state.start), Date.now(), d.balance_days_before)) return null;
      return { ...d, now: depositOf(total(), d.percent), balanceDate: daysBefore(state.start.slice(0, 10), d.balance_days_before) };
    };
    const pay = () => (deposit() ? state.pay : "full");
    // What the Book screen's button asks for, and what Pay must match.
    const due = () => (pay() === "deposit" ? deposit().now : total());
    const steps = (at) => {
      const all = paid() ? ["step_choose", "step_book", "step_pay", "step_confirmed"] : ["step_choose", "step_book", "step_confirmed"];
      const i = all.indexOf(at);
      return h`<div class="steps">${all.map((x, j) => h`<span class="${j === i ? "on" : j < i ? "past" : ""}">${say(x)}</span>`)}</div>`;
    };
    const rate = (x) => (x.per === "booking" ? amount(x.price) : say("an_hour", { amount: amount(x.price) }));
    const price = (s) => {
      const base = s.per_hour ? say("hour_minimum", { amount: amount(s.per_hour), hours: s.hours.min })
        : s.choice ? say("from", { rate: rate(optionsOf(s)[0][1]) })
        : s.price ? amount(s.price) : say("minutes_free", { minutes: s.minutes });
      return s.note ? h`${base} · ${s.note}` : base;
    };

    // Services the desk quotes itself: each a card that emails the desk.
    const quoted = () => (DESK ? Object.values(booking.quoted ?? {}) : []).map((q) =>
      h`<a class="card" href="mailto:${DESK}?subject=${encodeURIComponent(q.name)}"><b>${q.name}</b><span>${q.note ?? say("ask_desk")}</span></a>`);

    function choose(message = "", fresh = true) {
      (fresh ? show : redraw)(h`<div class="flow">${steps("step_choose")}${message}<h1 tabindex="-1">${say("choose_title")}</h1>
  <div class="cards">${services.map(([id, s]) => h`<button class="card" data-id="${id}" aria-pressed="${id === state.id}"><b>${s.name}</b><span>${price(s)}</span></button>`)}${quoted()}</div>
  <button class="btn go wide" data-go>${say("continue")}</button></div>`);
      view.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => { state.id = b.dataset.id; choose("", false); }));
      const go = view.querySelector("[data-go]");
      go.addEventListener("click", () => send(go, () => { begin(state.id); return load(); }));
    }

    // The total, and how to pay it where the start leaves a choice.
    function totals() {
      const s = service();
      const d = deposit();
      if (!paid()) return rows([[say("minutes", { minutes: s.minutes }), h`<b>${say("free")}</b>`]]);
      const sum = rows([[say("total"), h`<b>${amount(total())}</b>`]]);
      if (!d) return h`${sum}${s.deposit && state.start ? h`<p class="note">${say("full_only", { days: s.deposit.balance_days_before })}</p>` : ""}`;
      const option = (value, title, detail) => h`<label class="card"><input type="radio" name="pay" value="${value}"${state.pay === value ? h` checked` : ""}><b>${title}</b><span>${detail}</span></label>`;
      return h`${sum}<fieldset class="cards pick"><legend class="lab"><span>${say("how_to_pay")}</span></legend>
  ${option("deposit", say("now", { amount: amount(d.now) }), say("deposit_detail", { hours: d.hold_hours, rest: amount(total() - d.now), date: dateLabel(d.balanceDate) }))}
  ${option("full", say("now", { amount: amount(total()) }), say("full_detail"))}</fieldset>`;
    }

    const choices = (s) => s.choice && h`<fieldset class="cards pick"><legend class="lab"><span>${s.choice.label}</span></legend>
  ${optionsOf(s).map(([id, o]) => h`<label class="card"><input type="radio" name="choice" value="${id}"${state.choice === id ? h` checked` : ""}><b>${o.name}</b><span>${rate(o)}</span></label>`)}</fieldset>`;
    const extras = (s) => Object.entries(s.add_ons ?? {}).map(([id, a]) =>
      stepper(h`${a.name} · ${rate(a)}`, ["data-addon", id], say("one_of", { name: a.name.toLocaleLowerCase(lang) }), state.addOns[id], qtyOf(a)));

    // Stated before money is committed; the amounts come from the site's offer.
    const terms = () => say("terms", { hours: booking.cancel.full_before_hours, percent: booking.cancel.late_percent });

    // Draws the Book screen from the state: a new screen when `fresh`, else the same one again.
    // The text the person has typed is kept in `state.values` before every draw.
    function book({ message = "", errors = {}, fresh = false } = {}) {
      const s = service();
      const values = state.values;
      const field = (name, label, { type = "text", auto = "", required = true, area = false } = {}) => {
        const err = errors[name] && h`<span class="err" id="err-${name}">${say(errors[name] === "required" ? "fill_in" : "check_this")}</span>`;
        const attrs = h`name="${name}" id="f-${name}"${auto && h` autocomplete="${auto}"`}${required && h` required`}${errors[name] && h` aria-invalid="true" aria-describedby="err-${name}"`}`;
        const input = area ? h`<textarea ${attrs}>${values[name]}</textarea>` : h`<input type="${type}" ${attrs} value="${values[name]}">`;
        return h`<label class="field" for="f-${name}"><span class="lab"><span>${label}</span>${!required && h`<span>${say("optional")}</span>`}</span>${input}${err}</label>`;
      };
      const own = Object.entries(s.fields || {}).map(([name, need]) =>
        field(name, labelOf(s, name), { required: need === "required", area: name === "about" || name === "notes" }));
      (fresh ? show : redraw)(h`<div class="flow">${steps("step_book")}${message}${s.note && h`<span class="eye">${s.note}</span>`}<h1 tabindex="-1">${s.name}</h1>
  ${choices(s)}${extras(s)}${hourly(s) && stepper(say("hours"), ["data-hours", ""], say("one_hour"), state.hours, s.hours)}${slotPicker(booking, state.days, state.date, state.start)}
  <form class="form">${field("name", say("your_name"), { auto: "name" })}${field("email", say("email"), { type: "email", auto: "email" })}${field("mobile", say("mobile"), { type: "tel", auto: "tel" })}${own}
  ${totals()}${paid() && h`<p class="note">${terms()}</p>`}<button class="btn go wide" type="submit"${!state.start && h` disabled`}>${paid() ? say("pay_amount", { amount: amount(due()) }) : say("confirm")}</button></form><button class="btn quiet" data-back>${say("back")}</button></div>`);
      const again = (change) => (event) => { keep(); change(event.currentTarget); book(); };
      view.querySelectorAll("[data-date]").forEach((b) => b.addEventListener("click", again((x) => { state.date = x.dataset.date; state.start = ""; })));
      view.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", again((x) => { state.start = x.dataset.start; })));
      view.querySelectorAll("[data-addon]").forEach((b) => b.addEventListener("click", again((x) => { state.addOns[x.dataset.addon] += Number(x.dataset.step); })));
      view.querySelectorAll("input[name=choice], input[name=pay]").forEach((r) => r.addEventListener("change", again((x) => { state[x.name] = x.value; })));
      // The start times depend on the hours, so a new length asks the service again; it shows at once.
      view.querySelectorAll("[data-hours]").forEach((b) => b.addEventListener("click", () => send(b, () => {
        keep();
        state.hours += Number(b.dataset.step);
        b.parentNode.querySelector("output").textContent = state.hours;
        return load({ fresh: false });
      })));
      view.querySelector("[data-back]").addEventListener("click", () => choose());
      view.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        const go = event.target.querySelector("[type=submit]");
        if (!go.disabled) send(go, () => { keep(); return hold(); });
      });
    }

    function keep() {
      const form = view.querySelector("form");
      if (form) for (const [name, value] of new FormData(form)) if (name !== "pay") state.values[name] = value;
    }

    // Reads the open times for the service and hours, then draws the Book screen.
    async function load({ message = "", errors = {}, fresh = true } = {}) {
      const hours = hourly(service()) ? `&hours=${state.hours}` : "";
      const { status, data } = await call(booking, `/slots?service=${encodeURIComponent(state.id)}&from=${today()}&days=${DAYS_SHOWN}${hours}`);
      if (status !== 200 || !data.fresh) return show(unavailable());
      state.days = data.days.filter((d) => d.slots.some((t) => t.open));
      if (!state.days.some((d) => d.date === state.date)) state.date = state.days[0]?.date ?? "";
      const day = state.days.find((d) => d.date === state.date);
      if (!day?.slots.some((t) => t.open && t.start === state.start)) state.start = "";
      book({ message, errors, fresh });
    }

    async function hold() {
      const s = service();
      const { name, email, mobile, ...fields } = state.values;
      const body = { service: state.id, start: state.start, name, email, mobile, fields, checkout: "elements" };
      if (hourly(s)) body.hours = state.hours;
      if (s.choice) body.choice = state.choice;
      if (s.add_ons) body.add_ons = state.addOns;
      if (s.deposit && paid()) body.pay = pay();
      const asked = due();
      const { status, data } = await call(booking, "/holds", body);
      if (status === 201 && data.status === "holding" && data.checkout?.client_secret) return payHere(data, asked);
      if (status === 201 && data.status === "holding" && atCheckout(data.checkout_url)) return location.assign(data.checkout_url);
      if (status === 201 && data.status === "confirmed") return confirmed();
      if (status === 409) return load({ message: problem(say("taken")) });
      if (status === 422 && data.fields?.pay) { state.pay = "full"; return book({ message: problem(say("full_required")), fresh: true }); }
      if (status === 422) {
        const errors = data.fields || {};
        const marked = Object.keys(errors).some((k) => ["name", "email", "mobile"].includes(k) || Object.hasOwn(s.fields ?? {}, k));
        return book({ message: problem(say(marked ? "check_fields" : "check_choices")), errors, fresh: true });
      }
      if (status === 503) return show(unavailable());
      if (status === 429) return book({ message: problem(say("too_many", { desk })), fresh: true });
      return book({ message: problem(say("failed", { desk })), fresh: true });
    }

    // Paying in this page: the summary, the Pay button, its errors and its waiting state are the
    // site's own; only the card fields are Stripe's. Paying returns to the done page. The service's
    // figure is the one charged: where it differs from the one the Book screen showed, the page says so.
    function payHere(held, asked) {
      const charged = held.due_now ?? held.amount;
      show(h`<div class="flow">${steps("step_pay")}<span class="eye">${service().name} · ${whenLabel(state.start)}</span><h1 tabindex="-1">${say("pay_amount", { amount: amount(charged) })}</h1>
  ${charged !== asked && problem(say("price_changed", { amount: amount(charged) }))}
  <form class="form"><div data-stripe></div><div data-problem></div><button class="btn go wide" type="submit" disabled>${say("pay")}</button></form>
  <button class="btn quiet" data-back>${say("back")}</button></div>`);
      const go = view.querySelector("[type=submit]");
      const back = view.querySelector("[data-back]");
      const said = view.querySelector("[data-problem]");
      let checkout = null, fields = null, left = false, complete = false, hushed = false, appearance = {};
      // Stripe's own copy of a refusal under the card number, hidden while the page's alert says it.
      // Appearance rules cannot set `display`; a zero font and line hide it and keep the field's red edge.
      const hush = (on) => {
        hushed = on;
        checkout.changeAppearance(on ? { ...appearance, rules: { ...appearance.rules, ".Error": { fontSize: "0px", lineHeight: "0px", color: "transparent" } } } : appearance);
      };
      // Leaving frees the time, unless a payment already went through: the service then keeps the hold.
      const leave = async (then) => {
        if (left) return;
        left = true;
        fields?.destroy();
        const { data } = await call(booking, "/holds/release", { booking: held.booking });
        if (data.status === "holding") return show(unavailable(say("going_through", { desk })));
        then();
      };
      const failed = () => leave(() => show(unavailable(say("form_failed", { desk }))));
      back.addEventListener("click", () => send(back, () => leave(() => book({ message: notice(say("freed")), fresh: true }))));
      view.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        if (checkout && !go.disabled) send(go, async () => {
          said.innerHTML = "";
          try {
            // On success Stripe goes on to the done page; only a refusal comes back.
            const result = await checkout.confirm();
            if (result.type !== "error") return;
            // A field left unfinished (no code) carries Stripe's note under it; anything else is the page's to say, once.
            // Pressed again after a refusal, Stripe calls the same card unfinished and answers with no code: still the page's.
            if (hushed || complete || result.error.code) {
              said.innerHTML = problem(result.error.message);
              if (!hushed) hush(true);
            }
          } catch {
            said.innerHTML = problem(say("failed", { desk }));
          }
        });
      });
      // The fields open after the screen is drawn, so Back works while Stripe.js loads; nothing opens after it.
      (async () => {
        try {
          const Stripe = await stripeJs();
          if (left) return;
          const look = siteLook();
          appearance = look.appearance ?? {};
          const opened = await Stripe(held.checkout.publishable_key, { stripeAccount: held.checkout.account })
            .initCheckout({ fetchClientSecret: async () => held.checkout.client_secret, elementsOptions: look });
          if (left) return;
          checkout = opened;
          fields = checkout.createPaymentElement();
          fields.on("ready", () => { if (!left) go.disabled = false; });
          // Stripe calls a refused card unfinished, so only a complete one ends the refusal the page speaks for.
          fields.on("change", (e) => {
            complete = e.complete;
            if (complete && hushed) hush(false);
          });
          fields.on("loaderror", failed);
          fields.mount(view.querySelector("[data-stripe]"));
        } catch {
          failed();
        }
      })();
    }

    function confirmed() {
      show(h`<div class="flow">${steps("step_confirmed")}<span class="state"><i></i>${say("confirmed")}</span><h1 tabindex="-1">${service().name}</h1>
  <p>${whenLabel(state.start)}. ${say("sent_to", { email: state.values.email })}</p><a class="btn quiet" href="/">${say("back_to_site")}</a></div>`);
    }

    const asked = params.get("service");
    if (asked && Object.hasOwn(booking.services, asked)) {
      begin(asked);
      return load();
    }
    choose(note);
  }

  // After Stripe: wait for the payment notice, then say what was booked.
  async function donePage(booking) {
    const params = new URLSearchParams(location.search);
    const id = params.get("booking"), session = params.get("session");
    // Back from paying a balance through the emailed link. Anyone can type this address, and it
    // brings no session for /status to check, so it can never say the balance is paid.
    if (id && params.get("balance") === "paid" && !session) return notConfirmed("no_balance_proof");
    if (!id || !session) return show(unavailable());
    const started = Date.now();
    show(h`<div class="flow"><span class="state t"><i></i>${say("confirming")}</span><h1 tabindex="-1" role="status">${say("confirming_title")}</h1></div>`);
    for (;;) {
      const { status, data } = await call(booking, `/status?booking=${encodeURIComponent(id)}&session=${encodeURIComponent(session)}`);
      if (status === 200 && data.status === "confirmed") {
        return show(h`<div class="flow"><span class="state"><i></i>${say("confirmed")}</span><h1 tabindex="-1">${data.service_name}</h1>
  ${bookingRows(data)}<p>${say("sent_to", { email: data.email })}</p><a class="btn quiet" href="/">${say("back_to_site")}</a></div>`);
      }
      if (status === 200 && data.status === "expired") {
        return show(h`<div class="flow"><span class="state x"><i></i>${say("not_booked")}</span><h1 tabindex="-1">${say("released_title")}</h1><p>${say("released_text")}</p><a class="btn go" href="${booking.pages.book}">${say("book_again")}</a></div>`);
      }
      // The booking and session never match: asking again will not change that.
      if (status === 404) return notConfirmed("not_found");
      if (Date.now() - started > 60000) return notConfirmed("stripe_silent");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  function notConfirmed(why) {
    show(h`<div class="flow"><span class="state t"><i></i>${say("not_confirmed")}</span><h1 tabindex="-1">${say("not_confirmed_title")}</h1><p>${say(why)}</p>
  <p>${say("receipt", { desk })}</p><a class="btn quiet" href="/">${say("back_to_site")}</a></div>`);
  }

  // The manage link: the token sits in the address's fragment, so no server ever logs it.
  async function managePage(booking) {
    const token = location.hash.slice(1);
    if (!token) return show(fromEmail("manage_title", "confirmation_email"));
    let { status, data } = await call(booking, "/manage", { token });
    if (status === 404) return show(h`<div class="flow"><h1 tabindex="-1">${say("link_dead")}</h1><p>${say("email_desk", { desk })}</p></div>`);
    if (status !== 200) return show(unavailable());
    const amount = (n) => money(n, data.currency);
    // The booking keeps the policy it was made under, so the late rule is told by its own line.
    const refundText = (c) => (!c.refund ? say("no_refund")
      : c.rule === "late" && c.full_until ? say("refund_late", { amount: amount(c.refund), when: whenLabel(c.full_until) })
      : say("refund", { amount: amount(c.refund) }));

    function overview(message = "") {
      const state = { cancelled: "cancelled", declined: "declined_by_desk" }[data.status];
      const actions = [
        data.move?.allowed && h`<button class="btn" data-move>${say("move")}</button>`,
        data.cancel?.allowed && h`<button class="btn" data-cancel>${say("cancel")}</button>`,
      ].filter(Boolean);
      const after = actions.length ? h`<div class="btns">${actions}</div>` : !state && h`<p class="note">${say("locked", { desk })}</p>`;
      show(h`<div class="flow">${message}<span class="state${state ? " x" : ""}"><i></i>${say(state ?? "confirmed")}</span><h1 tabindex="-1">${data.service_name}</h1>${bookingRows(data)}${after}</div>`);
      view.querySelector("[data-cancel]")?.addEventListener("click", () => confirmCancel());
      const moving = view.querySelector("[data-move]");
      moving?.addEventListener("click", () => send(moving, () => move()));
    }

    function confirmCancel(message = "") {
      show(h`<div class="flow">${message}<span class="eye">${data.service_name} · ${whenLabel(data.start)}</span><h1 tabindex="-1">${say("cancel_title")}</h1>
  <p>${refundText(data.cancel)}</p><div class="btns"><button class="btn go" data-yes>${say("cancel_yes")}</button><button class="btn quiet" data-no>${say("cancel_no")}</button></div></div>`);
      view.querySelector("[data-no]").addEventListener("click", () => overview());
      const yes = view.querySelector("[data-yes]");
      yes.addEventListener("click", () => send(yes, async () => {
        const r = await call(booking, "/manage/cancel", { token, refund: data.cancel.refund });
        if (r.status === 200) {
          data = { ...data, status: "cancelled", cancel: { allowed: false }, move: { allowed: false } };
          return overview(notice(r.data.refund ? say("cancelled_refund", { amount: amount(r.data.refund) }) : say("cancelled_none")));
        }
        if (r.status === 409 && r.data.error === "refund_changed") {
          data.cancel = r.data.cancel;
          return confirmCancel(problem(say("refund_changed")));
        }
        if (r.status === 409) return overview(problem(say("no_cancel")));
        return confirmCancel(problem(say("failed", { desk })));
      }));
    }

    // Any open time of the same length, until the line the confirmation names; no money moves.
    // The times are read once; picking a date or a time only draws the screen again.
    async function move(message = "") {
      const r = await call(booking, "/manage/slots", { token, from: today(), days: DAYS_SHOWN });
      if (r.status !== 200 || !r.data.fresh) return overview(problem(say("times_unreadable")));
      const days = r.data.days.filter((d) => d.slots.some((t) => t.open));
      const pick = { date: days[0]?.date ?? "", start: "" };
      const draw = (message, fresh) => {
        (fresh ? show : redraw)(h`<div class="flow">${message}<span class="eye">${data.service_name} · ${say("now_at", { when: whenLabel(data.start) })}</span><h1 tabindex="-1">${say("move_title")}</h1>
  ${slotPicker(booking, days, pick.date, pick.start)}<p class="note">${say("moves_free", { when: whenLabel(data.move.until) })}</p>
  <button class="btn go wide" data-go${!pick.start && h` disabled`}>${say("move_go")}</button><button class="btn quiet" data-back>${say("keep_time")}</button></div>`);
        view.querySelectorAll("[data-date]").forEach((b) => b.addEventListener("click", () => { Object.assign(pick, { date: b.dataset.date, start: "" }); draw("", false); }));
        view.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => { pick.start = b.dataset.start; draw("", false); }));
        view.querySelector("[data-back]").addEventListener("click", () => overview());
        const go = view.querySelector("[data-go]");
        go.addEventListener("click", () => send(go, async () => {
          const moved = await call(booking, "/manage/move", { token, start: pick.start });
          if (moved.status === 200) { data = moved.data; return overview(notice(say("moved", { when: whenLabel(data.start) }))); }
          if (moved.status === 409 && moved.data.error === "slot_taken") return move(problem(say("taken")));
          if (moved.status === 409) return overview(problem(say("no_move")));
          return draw(problem(say("failed", { desk })), true);
        }));
      };
      draw(message, true);
    }

    overview();
  }

  // The desk's link from a booking email: the booking, and declining it with a reason the client reads.
  async function deskPage(booking) {
    const token = location.hash.slice(1);
    if (!token) return show(fromEmail("desk_title", "notification_email"));
    const { status, data } = await call(booking, "/desk", { token });
    if (status === 404) return show(h`<div class="flow"><h1 tabindex="-1">${say("link_dead")}</h1></div>`);
    if (status !== 200) return show(unavailable());
    const amount = (n) => money(n, data.currency);
    const details = rows([[say("client"), data.name], [say("email"), data.email], [say("mobile"), data.mobile],
      ...Object.entries(data.fields || {}).map(([k, v]) => [labelOf(booking.services[data.service], k), v])]);

    function overview(message = "") {
      const state = { cancelled: "cancelled", declined: "declined" }[data.status];
      const decline = data.decline?.allowed && h`<form class="form" data-decline><label class="field" for="f-reason"><span class="lab"><span>${say("reason")}</span></span><textarea id="f-reason" name="reason" required maxlength="1000"></textarea></label>
  <p class="note">${say(data.decline.how === "release" ? "hold_released" : "refunded", { amount: amount(data.decline.returns) })}</p><button class="btn go" type="submit">${say("decline_go")}</button></form>`;
      show(h`<div class="flow">${message}<span class="state${state ? " x" : ""}"><i></i>${say(state ?? "booked")}</span><h1 tabindex="-1">${data.service_name}</h1>${bookingRows(data)}${details}${decline}</div>`);
      view.querySelector("[data-decline]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        send(event.target.querySelector("[type=submit]"), async () => {
          const r = await call(booking, "/desk/decline", { token, reason: new FormData(event.target).get("reason") });
          if (r.status === 200) {
            data.status = "declined";
            data.decline = { allowed: false };
            return overview(notice(say("declined_done", { amount: amount(r.data.returns) })));
          }
          if (r.status === 409) { data.decline = { allowed: false }; return overview(problem(say("started"))); }
          return overview(problem(say("failed_desk")));
        });
      });
    }

    overview();
  }

  const booking = await offer();
  if (!booking) return;
  if (booking.words && typeof booking.words === "object") words = { ...words, ...Object.fromEntries(Object.entries(booking.words).filter(([, w]) => typeof w === "string")) };
  desk = DESK ? h`<a href="mailto:${DESK}">${DESK}</a>` : say("the_desk");
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
