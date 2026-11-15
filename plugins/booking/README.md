# Booking

Places a booking flow on a page. The content inside the fence is what shows with no script, so it should be a plain way to reach you.

```
:::booking {page=book desk=desk@example.com}
[Email the desk to book](mailto:desk@example.com)
:::
```

`page` is `book`, `done`, `manage` or `desk`. Colours, faces and sizes come from the site's tokens; set a `--booking-*` token in the theme for anything else: `--booking-heading-case` and `--booking-heading-stretch` for the headings, `--booking-label-font`, `--booking-label-case` and `--booking-label-spacing` for the small labels and buttons, `--booking-radius` for the corners (2px by default). Stripe's card fields on the pay step read the same tokens when they open. Stripe loads the site's own font files inside its frame, so they must be served with `Access-Control-Allow-Origin`; without it the fields fall back to the next face in the stack. The offer is the `[services.booking]` table in `.moss/config.toml`. The values the page needs from it (services, prices, deposits, questions, cancellation terms, page addresses) are published at `/_moss/extensions/booking.json`, which is also where the booking service reads the offer, opening hours included.

The offer is edited in the plugin's tab in moss, or by hand in the same table; both write the same keys. Leave `endpoint` out and the build fills in the booking service's address for the site.

A service with `hours` may also carry `choice = { label = "Route", options = { coast = { name = "Coast", per = "hour", price = 11000 }, … } }` and `[services.booking.services.<id>.add_ons.<id>]` tables (`name`, `price`, `per`, `qty = { min, max }`); prices are cents. The page and the booking service sum them with one formula, and `test/price-vectors.json` is a copy, pinned by checksum, of the cases the booking service is tested against; the service's copy is the source. A total over 999,999.99 is refused.

The words a visitor reads are English, or Simplified Chinese on a page whose `lang` is `zh` (`zh-CN`, `zh-Hans`); money and dates follow the page's `lang`. Any word can be replaced in the offer's `words` table, by the key the script names it with, for example `words = { continue = "Next" }`. Services the desk prices itself go in `[services.booking.quoted.<id>]` (`name`, and a `note` in place of "Ask the desk"): each shows on the Choose screen as a card that emails the desk.
