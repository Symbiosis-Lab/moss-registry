#!/usr/bin/env bash
# starters/essays/fixups.sh
#
# Edits a mechanical cut cannot infer. Registry tooling, not shipped:
# cut-starter.sh runs it with the working directory at site/ after every
# re-cut. Idempotent -- a no-op once applied.
set -euo pipefail

# Two comments in the full site's theme point at a design note that is not
# shipped and at another person's site as a reference. Neither belongs in a
# public starter, and the sentences read the same without them.
perl -0pi -e '
  s/ -- only the numbers moved off \w+.s\n\s+340\/35\/93\/13\././;
  s/ \(\S+\.com\n\s+style; see \S+\.md\)//;
' .moss/theme/style.css
