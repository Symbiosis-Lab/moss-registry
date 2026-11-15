#!/bin/sh
# The registry's build contract: build from this source, package the archive,
# print its path as the last line of stdout. Logs go to stderr.
exec sh "$(dirname "$0")/scripts/package.sh" linux-arm64
