# Changelog

## 0.2.0

- The plugin's tab in moss edits the offer: services with an hourly rate or a fixed price, deposits and questions, opening hours, how far ahead a booking may be made, and the cancellation terms. Each change is written into `[services.booking]` in `.moss/config.toml`, so the file stays the one place the offer lives.
- The booking service's address is no longer written by hand: the build publishes it for the folder's site when `endpoint` is left out. An address written in the table still wins.
- Connect Stripe in the tab opens the payment sign-up for the site.
- The desk and manage pages, opened without the link from their email, say which email the link is in instead of saying booking is unavailable.
- The published offer carries only the values the page needs, named path by path (opening hours and the booking window are left to the booking service), and the element shows the page's own content when that file is in a format it was not written for.
- Needs moss 0.15.23, the first release with plugin blocks, published settings and settings in the site's table.

## 0.1.0

- A preview (`"preview": true`): a `:::booking` block places `<moss-booking>`, moved unchanged from Meta Force's hand-built booking pages. The fence's body is the page's content with no script or no offer.
