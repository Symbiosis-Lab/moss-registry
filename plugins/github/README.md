# @symbiosis-lab/moss-plugin-github

> Publish moss sites to GitHub Pages.

[![status](https://img.shields.io/badge/status-experimental-orange)](#stability)

A moss publishing plugin for GitHub Pages. See [moss.pub](https://mosspub.com) and the [registry](https://github.com/Symbiosis-Lab/moss-registry) for the full plugin lineup.

## Network access

- **`github.com`** — pushes your built site to your repository over HTTPS. The
  plugin runs `git` to do this, which is why it declares the `execute_binary`
  capability in its manifest.
- **`api.github.com`** — creates the repository if it does not exist, turns on
  GitHub Pages, sets a custom domain when you configure one, and reads back
  deployment status so moss can tell you when the site is live. Also used for
  the device-code sign-in that obtains your token.

Nothing else is contacted. The plugin sends your site's built files and the
repository settings you configure; it does not send analytics.

## Stability

This plugin is 0.x. APIs may change between minor versions until 1.0. See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT.
