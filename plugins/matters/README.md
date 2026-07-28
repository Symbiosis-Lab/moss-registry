# @symbiosis-lab/moss-plugin-matters

> Publish moss posts to matters.town.

[![status](https://img.shields.io/badge/status-experimental-orange)](#stability)

A moss publishing plugin for matters.town. See [moss.pub](https://mosspub.com) and the [registry](https://github.com/Symbiosis-Lab/moss-registry) for the full plugin lineup.

## Network access

- **`matters.town`** — the GraphQL API: signing in, publishing articles, and
  reading back your own posts and collections when importing.
- **`server.matters.town`** — the API host some deployments resolve to.
- **`matters.icu`** — the staging environment, used only when a project is
  pointed at it for testing.
- **`assets.matters.news`** — downloads the images belonging to posts you
  import, so they land in your project as local files.

Nothing else is contacted. The plugin sends the articles you choose to
syndicate; it does not send analytics.

## Stability

This plugin is 0.x. APIs may change between minor versions until 1.0. See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT.
