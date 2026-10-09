#!/usr/bin/env bash
set -euo pipefail

# A starter inherits the destination folder name; its home is structural.
if [[ -f 'Chautauqua Literary and Scientific Circle.md' ]]; then
  mv 'Chautauqua Literary and Scientific Circle.md' index.md
fi
perl -0pi -e 's/^title:.*\n//m' index.md
