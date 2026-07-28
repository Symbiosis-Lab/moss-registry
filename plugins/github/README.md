# @symbiosis-lab/moss-plugin-github

> Publish moss sites to GitHub Pages.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![status](https://img.shields.io/badge/status-experimental-orange)](../#stability)

> **Read-only mirror.** Source lives in the private moss monorepo. PRs cannot be merged in the mirror — see [CONTRIBUTING.md](../CONTRIBUTING.md).

A moss publishing plugin for GitHub Pages. See [moss.pub](https://mosspub.com) and the [plugin index](../README.md) for the full plugin lineup.

## Stability

This plugin is 0.x. APIs may change between minor versions until 1.0. See [CHANGELOG.md](../CHANGELOG.md).

## Network access

- `github.com` / `api.github.com` — creates and updates the deployment
  repository, pushes the built site, and reads Pages/workflow status.

This plugin also runs `git` on your machine to push the built site, which is why
its manifest declares `requires: ["execute_binary"]`.

## License

MIT — see [LICENSE](../LICENSE).
