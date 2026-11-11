# Booking

Places a booking flow on a page. The content inside the fence is what shows with no script, so it should be a plain way to reach you.

```
:::booking {page=book desk=desk@example.com}
[Email the desk to book](mailto:desk@example.com)
:::
```

`page` is `book`, `done`, `manage` or `desk`. Colours and fonts come from the site; override a `--booking-*` token in the theme for anything else. The offer is the `[services.booking]` table in `.moss/config.toml`. The values the page needs from it (services, prices, deposits, questions, cancellation terms, page addresses) are published at `/_moss/extensions/booking.json`; the booking service reads the whole offer, opening hours included, from the site's `_moss/commerce.json`.

The offer is edited in the plugin's tab in moss, or by hand in the same table; both write the same keys. Leave `endpoint` out and the build fills in the booking service's address for the site.
