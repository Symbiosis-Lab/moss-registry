# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Added: a site whose map has a historical layer (`kind = "historical"`) can list Allmaps annotation URLs under `annotations`. Before the site is built, the plugin downloads each scan into the layer's `source` folder, cropped to the layer's area and sized to the layer's highest zoom at twice the screen density, with the annotation and a small record of what was fetched next to it. Scans already in the folder are not fetched again, so a site opens offline once its scans are there.
- Added: before fetching a scan, the plugin compares the size the image service reports now with the size the annotation was made on. If the library has re-cut the image since it was georeferenced, or the service cannot be read, that scan is refused with a message saying so and how to fix it, instead of being cut from the wrong pixels and drawn in the wrong place. The run summary counts refused scans separately.
