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

External image URLs in outgoing posts are also submitted to Matters for asset upload. The plugin sends only the posts whose `syndicate:` names Matters, a short post as a moment and an article published directly after every picture has uploaded; it does not send analytics.

## Stability

This plugin is a preview. See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT.
