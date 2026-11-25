# Changelog

## 0.4.1

- A logo for moss's plugin list: a calendar with a check.

## 0.4.0

- A press that sends makes every control in the booking inert until its answer is drawn, and the pressed button turns; this covers Continue, the hours, Book, Pay, Move, Cancel and Decline, and a failed answer releases it. What the visitor types while it waits is kept. The move screen reads its times once.
- Choosing a card, an option, an add-on, a date or a time draws the screen again with focus and the page where they were.
- Every visitor word comes from one table, in English and Simplified Chinese by the page's `lang`; the offer's `words` table replaces any of them. Money and dates follow the page's `lang`, and amounts use the currency's own minor unit.
- `quoted` in the offer lists services the desk prices itself, shown as cards that email the desk. The trip request screen is gone.
- A deposit is offered by the booking service's own rule (whole days by the clock before the start), checked against the shared vectors; Pay says so when the service's figure differs from the Book screen's.
- The stylesheet takes its colours, faces and case from the site's tokens, with `--booking-heading-*` and `--booking-label-*` for a site's own heading and label style.

## 0.3.0

- A service can be priced by a choice and add-ons: `choice` is one required pick among options that each carry a price, `add_ons` are extras with a quantity range, and each is charged `per = "hour"` (the default) or once per booking. A service with `hours` and a `choice` needs no `per_hour`. `note` is a line shown with the service on Choose and Book and in the confirmation mail. The tab edits all three. The total is the rate, plus the choice, plus each add-on's quantity times its unit price; the booking service computes the same sum and its answer is the one that charges.
- One booking screen replaces When and Who: options, time, details and the total, then Pay. The total shows on that screen and on Pay and nowhere else, and the button says what it charges.
- The published offer carries every key the booking service reads, including the opening hours and booking window, so the service takes the offer from `/_moss/extensions/booking.json`.
- The desk and manage pages, and the booking's confirmation, list what was picked, and the desk page words each question as the offer does.
- A pressed button answers at once: Continue, the hours stepper, the Book screen's button and Pay turn a ring until the screen they asked for is drawn, and a second press while waiting does nothing. The hours show the new length before the times arrive.
- The deposit shown on Book and Pay is rounded down to the cent, as the booking service holds it; it was rounded to the nearest cent and could show one cent more.

## 0.2.0

- The plugin's tab in moss edits the offer: services with an hourly rate or a fixed price, deposits and questions, opening hours, how far ahead a booking may be made, and the cancellation terms. Each change is written into `[services.booking]` in `.moss/config.toml`, so the file stays the one place the offer lives.
- The booking service's address is no longer written by hand: the build publishes it for the folder's site when `endpoint` is left out. An address written in the table still wins.
- Connect Stripe in the tab opens the payment sign-up for the site.
- Paying happens in the site's own page: the summary, the Pay button, its waiting state and Stripe's refusals are the site's markup, and only the card fields are Stripe's (its Payment Element). The fields take the site's colours, body face and corner radius from the element's tokens as they open, so a redesign reaches them. A booking service without this answers with Stripe's own page, as before. One press on Continue makes one hold. A refused card is said once, in the site's alert, and again there if Pay is pressed with the same card; Stripe's notes under the fields stay hidden until a complete card is entered. A field left unfinished keeps Stripe's note under it.
- The desk and manage pages, opened without the link from their email, say which email the link is in instead of saying booking is unavailable.
- The published offer carries only the values the page needs, named path by path (opening hours and the booking window are left to the booking service), and the element shows the page's own content when that file is in a format it was not written for.
- Needs moss 0.15.23, the first release with plugin blocks, published settings and settings in the site's table.

## 0.1.0

- A preview (`"preview": true`): a `:::booking` block places `<moss-booking>`, moved unchanged from Meta Force's hand-built booking pages. The fence's body is the page's content with no script or no offer.
