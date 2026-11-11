# Changelog

## 0.2.0

- The plugin's tab in moss edits the offer: services with an hourly rate or a fixed price, deposits and questions, opening hours, how far ahead a booking may be made, and the cancellation terms. Each change is written into `[services.booking]` in `.moss/config.toml`, so the file stays the one place the offer lives.
- The booking service's address is no longer written by hand: the build publishes it for the folder's site when `endpoint` is left out. An address written in the table still wins.
- Connect Stripe in the tab opens the payment sign-up for the site.
- Needs moss 0.15.22.

## 0.1.0

- A preview (`"preview": true`): a `:::booking` block places `<moss-booking>`, moved unchanged from Meta Force's hand-built booking pages. The fence's body is the page's content with no script or no offer.
