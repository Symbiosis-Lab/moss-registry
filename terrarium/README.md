# terrarium

An internal harness for exercising moss's plugin-facing UI surfaces — job
windows, advisories, and sync status — without needing a real external service.

It is **not a user-facing plugin** and is not published to the registry
(`"private": true` in its `package.json`). It exists so those surfaces can be
driven deterministically while developing moss itself.

## Usage

```bash
npm ci
npm run build
```

Then symlink `dist/` into a test project's `.moss/plugins/terrarium/` and open
the folder in moss.

## Network access

None. The harness renders local fixtures only and makes no outbound requests.

## License

MIT — see [LICENSE](../LICENSE).
