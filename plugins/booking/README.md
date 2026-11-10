# Booking

Places a booking flow on a page. The content inside the fence is what shows with no script, so it should be a plain way to reach you.

```
:::booking {page=book desk=desk@example.com}
[Email the desk to book](mailto:desk@example.com)
:::
```

`page` is `book`, `done`, `manage` or `desk`. Colours and fonts come from the site; override a `--booking-*` token in the theme for anything else. The offer is the `[services.booking]` table in `.moss/config.toml`, published at `/_moss/extensions/booking.json`.
