# Threads

Posts short copies, reply threads and article teasers to your own Threads account, preserving moss's shaped text and links back to your site. This is a preview plugin for moss 0.15.19 or newer. It does not publish articles, upload images, or edit copies after publication.

## Connect your account

1. Create a Meta developer app with the Threads API use case and connect the Threads account you want to publish as. The plugin uses `/me`, so there is no user-id setting.
2. Arrange access for that account in the app's development/test setup, then authorize `threads_basic`, `threads_content_publish` and `threads_delete`. The development-mode tester exemption from App Review and the exact tester invitation/acceptance UI are **unverified**; check the current Meta console before relying on them. Access for other people's accounts may require Meta review.
3. Obtain a long-lived user access token using Meta's developer tools. Store it in moss's channel settings, or pipe it from your secret manager into `moss plugin secret set threads access_token ~/my-site`. Keep the token out of the site's files and shell history.
4. Name `threads` in the folder's `cascade: syndicate:` list, as below, and publish. Validate the preview against a test account before relying on it for unattended posting.

```yaml
---
title: Notes
cascade:
  syndicate: [threads]
---
```

Long-lived tokens are documented as lasting 60 days. Renewal is manual: obtain a replacement and run `moss plugin secret set threads access_token` for the site again. The plugin never calls the refresh endpoint. A revoked or expired token produces an authentication refusal. The short-lived token lifetime has not been freshly verified.

## Text and recovery

The manifest declares a 500-character limit, conservatively measured as UTF-16 units with URLs counted in full. This is a shaping policy, **not a claim about Threads' official counting algorithm**. Exact URL and Unicode counting remain unverified. Every part is posted exactly as moss supplies it; a teaser also supplies `link_attachment` with the original's URL. Titles, descriptions and covers are not sent as separate page-display metadata.

Each part gets an unpublished TEXT container, then up to five readiness checks one second apart. Only `FINISHED` is published. `IN_PROGRESS` waits; `ERROR` or `EXPIRED` refuses; unknown statuses and timeouts refuse before publication. The status vocabulary, cadence and reply lookup fields are provisional and require a live test. No quota number is assumed.

A stated refusal partway through a thread deletes its published parts in reverse order before reporting that moss may retry. Failed deletion, a lost publish response, an invalid publish id, or any lookup failure after publication throws: moss leaves the copy unconfirmed instead of automatically reposting. Unpublished containers are not copies and may expire on the service.

Recovery reads recorded ids with `GET /{thread_id}`, or checks at most 100 recent posts for exactly matching text and reply relationships. A missing, partial, edited or ambiguous match throws; a bounded listing never proves absence. The plugin follows no pagination links. Confirm an uncertain copy before using `moss deploy --retry-copies=threads`; forcing a retry can duplicate it. Adding a thread's first URL to `syndicated:` alone does not recover its reply ids for later deletion. Deletion requires an explicit `success: true`; an unknown or already-gone id remains uncertain instead of treating every API error as absence.

## Network access

- `https://graph.threads.net/v1.0`: `POST /me/threads`, `POST /me/threads_publish`, container readiness and published-post `GET /{id}`, `GET /me/threads` for bounded recovery, and `DELETE /{thread_id}`.
- The hidden `api` setting accepts only that HTTPS origin or an explicit `http://127.0.0.1[:port]` stand-in. The origin is checked before reading `access_token`; credentials are carried only in an Authorization header, never query strings or returned error messages.
- Requests specify `redirect: "error"`. **Host limitation:** moss `origin/develop` at `29b3b79c8f2830c568972f4b9fc8603066232f95` ignores this fetch option (`engine/fetch_shim.rs`) and uses an agent with redirects enabled (`plugins/runtime/download.rs`, `system/proxy.rs`). Plugin unit tests do not establish redirect refusal in that host. Host enforcement needs separate review/fix before the credential boundary can be certified for live use.

## Validation and evidence

From this directory run `npm ci`, `npm test` and `npm run build`. The registry validator runs from the repository root with `node .github/scripts/validate-plugin.mjs plugins/threads`. The [syndication harness](../../harness/syndication/README.md) exercises real moss against a Node loopback stand-in; it never contacts Meta. Neither these tests nor the stand-in establish live API compatibility.

The implementation follows research supplied for this job on 2026-11-11 from Meta's official [Threads Postman collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api), including [publication](https://www.postman.com/meta/threads/request/34203612-c940a17f-e719-4b5b-9d28-7390bc658fb7), [lookup](https://www.postman.com/meta/threads/request/34203612-416ad6d2-214e-415a-bfe4-98c959fe25ad), [deletion](https://www.postman.com/meta/threads/request/34203612-0a51cfc6-6407-4aec-974f-5bcbfbbf9da3), [container status](https://www.postman.com/meta/threads/request/34203612-72c20362-5b0c-4f14-b9cd-4315ff91cd85), and [publishing limits](https://www.postman.com/meta/threads/request/34203612-f4590341-9bee-44f5-901b-606078a03c96). Those pages have no publication date; the supplied overview displayed November 7, 2026. Direct developer documentation was throttled during that research and is not claimed as verified. The supplied 500-character limit evidence was Meta's September 5, 2025 announcement. A live test must confirm counting, status transitions, reply field behavior, tester setup and the host's redirect handling; it must not be inferred from the stand-in passing.
