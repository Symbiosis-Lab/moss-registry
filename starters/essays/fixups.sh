#!/usr/bin/env bash
# starters/essays/fixups.sh
#
# Edits a mechanical cut cannot infer. Registry tooling, not shipped:
# cut-starter.sh runs it with the working directory at site/ after every
# re-cut. Idempotent -- a no-op once applied.
set -euo pipefail

# A starter inherits the destination folder name; its home is structural.
if [[ -f 'Virginia Woolf.md' ]]; then
  mv 'Virginia Woolf.md' index.md
fi
perl -0pi -e 's/^title:.*\n//m' index.md
