# registry/

Registry metadata the moss app reads.

## `revoked.json` — the kill switch

The one way to reach plugins already installed on users' machines. moss fetches
it alongside the index and refuses to load any listed version, badging it in the
catalog with the reason.

```json
{
  "schema_version": 1,
  "serial": 7,
  "revocations": [
    {
      "id": "example",
      "versions": ["1.1.0", "1.1.1"],
      "reason": "Exfiltrated vault contents via an undisclosed endpoint.",
      "advisory_url": "https://github.com/Symbiosis-Lab/moss-registry/security/advisories/..."
    }
  ]
}
```

- `versions` is an explicit list, or `"*"` to revoke every version of that id.
- `reason` is shown to users verbatim. Write it for a writer, not an engineer.
- **`serial` must be incremented on every change.** Clients keep the highest
  serial they have seen and reject anything lower, so a stale copy cannot be
  replayed to un-revoke a bad version. CI rejects a PR that edits this file
  without raising the serial.

Revocation is *not* retroactive deletion: also delete the release assets for the
revoked versions, so a replayed index entry resolves to nothing. Delete the
*assets*, not the tag — release tags cannot be deleted, and that is deliberate.
A released version is final; revoking it and publishing a new one is the only
correction, because replacing a version in place would swap bytes underneath
everyone who already installed it.

## `index.json`

Not committed. It is generated on merge from the set of existing releases (with
each zip's sha256) and deployed to GitHub Pages alongside this file, so it always
describes what has actually been released rather than what someone hand-edited.
Every field comes from the manifest *inside* the published zip, so an entry
cannot describe something other than the bytes it points at.

moss fetches both files from one pinned origin:

```
https://symbiosis-lab.org/moss-registry/index.json
https://symbiosis-lab.org/moss-registry/revoked.json
```

That origin is a trust anchor, not a deployment detail. v1 files are unsigned, so
whoever serves the bytes is trusted — which is why there is exactly one origin,
no mirrors and no fallbacks.

**Pin that host, not `symbiosis-lab.github.io`.** The organization serves Pages
under its own domain, so the `github.io` form answers `301` and redirects here.
A trust anchor may not ride on a redirect: the thing being trusted would be
whatever the redirect points at that day. Two consequences follow — HTTPS is
enforced on this site, and DNS control of `symbiosis-lab.org` is now part of the
anchor alongside merge rights on this repo.

A release is indexed when it is **published** (not a draft, not a prerelease),
its tag reads `<id>-v<semver>`, and the manifest in its zip agrees with that tag.
Of the releases for an id, only the highest version is listed.

Two consequences worth knowing:

- **Drafting a release is how a package leaves the catalog.** It is the retirement
  mechanism, not just bookkeeping — an old release left published keeps being
  offered to users. Un-drafting puts it back.
- A release whose zip disagrees with its tag **fails the run** rather than being
  skipped. Quietly dropping it would look to every client exactly like a
  revocation.

### What the index re-emits from a manifest

The rule, so the field list is never re-debated: **the index re-emits every
manifest field that drives pre-install catalog presentation.** Post-install
fields (`config_schema`, `contributes`, `domain`, `domains`, `entry`,
`config_verify`) stay out — once the plugin is installed, its own manifest is
authoritative for those.

Two optional booleans, both omitted when false so older entries serialize
unchanged:

- **`preview`** — the publisher says this version is not ready to be offered
  by default. This is *presentation, never a safety mechanism*: safety is
  `revoked.json` (fail-closed) or drafting the release. moss's current
  interpretation is stricter than VS Code's "preview" badge: the row is
  omitted from the catalog entirely unless the user has turned on preview
  features. moss may relax that to a badged, visible row at any time without
  an index change or a republish. Because release zips are immutable, **a
  readiness change requires publishing a new version.**
- **`requires_stack`** — first install pulls a machine-wide companion runtime;
  clients use it to show a download-consent surface before install.
