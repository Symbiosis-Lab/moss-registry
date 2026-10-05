#!/usr/bin/env bash
# starters/vertical/fixups.sh
#
# One-off textual corrections a mechanical cut cannot infer, because they are
# editorial calls rather than integrity checks (integrity checks -- a dangling
# `location:` or `sort:` reference -- are handled generically by
# scripts/prune-places.py and scripts/prune-sort-lists.py). Registry tooling,
# not shipped: cut-starter.sh runs it with the working directory at site/
# after every re-cut. Every edit is idempotent -- a no-op once applied -- so
# re-running the cut is safe. See README.md beside this file.
set -euo pipefail

# 1. 八大山人.md's provenance comment quotes [[目]], a wikilink to a page
#    renamed away from that name long ago in the full site itself -- it
#    doesn't resolve even there, so the cut isn't what broke it, and a
#    generic link-fixer would be guessing at authorial intent to repair it.
#    De-link to the bare word.
perl -pi -e 's/\[\[目\]\]/目/' 八大山人.md

# 2. 文/文.md, 書/書.md, 畫/畫.md: the full site deliberately leaves
#    prev/next off across dozens of children. The starter keeps only a
#    handful per folder, where prev/next between the kept works earns its
#    keep -- turn on the `series: true` opt-in for those folders.
for f in 文/文.md 書/書.md 畫/畫.md; do
  grep -q '^series: true$' "$f" && continue
  awk 'BEGIN{c=0} /^---$/{c++; if(c==2){print "series: true"}} {print}' "$f" > "$f.tmp"
  mv "$f.tmp" "$f"
done

# 3. Provenance comments cite a page of the full site's own notes folder, which
#    this starter does not ship. Name it as a page of the full site instead of
#    as a path that does not exist here.
find . -name '*.md' -exec perl -pi -e 's/\.moss\/notes\/印與名號\.md(（原 [^）]*）)?/全站「印與名號」一頁/g' {} +

# 4. Pictures that are not in this cut. Only works whose images carry clear
#    reuse terms are kept, so the full site's home page, folder covers and
#    letters name images that are not here. Each step below is a no-op once
#    applied.

# 4a. The home page: a kept image for the share card, and a featured list of
#     kept works. The comment bullets about the old share-card image go.
perl -pi -e 's/^cover: 孤禽圖_cover\.jpg$/cover: 畫\/荷花禽鳥圖_cover.jpg/' 八大山人.md
perl -0pi -e 's/:::grid \{\.summary\}\n.*?\n:::/:::grid {.summary}\n[[畫\/雙鷹圖|雙鷹圖]]\n+++\n[[畫\/荷花禽鳥圖|荷花禽鳥圖]]\n+++\n[[畫\/河上花圖|河上花圖]]\n+++\n[[畫\/魚石圖卷|魚石圖卷]]\n+++\n[[畫\/山水冊|山水冊]]\n+++\n[[畫\/傳綮寫生冊|傳綮寫生冊]]\n:::/s' 八大山人.md
perl -ni -e 'print unless /^- 2026-09-(07|10) 分享圖/' 八大山人.md

# 4b. Folder covers.
perl -pi -e 's/^cover: 安晚冊\.jpg$/cover: 雙鷹圖.jpg/' 畫/畫.md
perl -pi -e 's/^cover: 個山小像_cover\.jpg$/cover: 河上花歌_1.jpg/' 文/文.md
perl -ni -e 'print unless /^- 2026-09-14 cover 改用 個山小像_cover/' 文/文.md

# 4c. Writings kept as text pages: their scans are not in the cut, and the
#     words read complete without them. Drop the plate block (image, optional
#     caption) and the cover that pointed at it, and the comment bullets that
#     cite those images.
for f in 文/與石濤書.md 文/致方士琯十三札/專使促駕.md 文/致方士琯十三札/只手少甦.md 文/致方士琯十三札/窮變得意處.md; do
  perl -0pi -e 's/::: \{\.plate\}\n!\[[^\]]*\]\([^)]*\)\n(?:\n[^\n]*\n)?:::\n\n//; s/^cover: [^\n]*\.jpg\n//m' "$f"
done
perl -ni -e 'print unless /^- (圖版：|2026-09-10 刪借用之圖|2026-09-10 此札圖版|2026-09-23 補圖)/' 文/與石濤書.md 文/致方士琯十三札/專使促駕.md 文/致方士琯十三札/只手少甦.md 文/致方士琯十三札/窮變得意處.md
perl -ni -e 'print unless /^- 2026-09-10 撤首圖：/' 文/致方士琯十三札/致方士琯十三札.md

# 4d. 魚石圖卷: the Wikimedia Commons file is tagged PD-Art; say so in the
#     page's source note (checked against the Commons API).
perl -pi -e 's/^(- 影像：https:\/\/commons\.wikimedia\.org\/wiki\/File:Bada_Shanren[^\n]*?) 。$/$1 ，維基共享資源標記 PD-Art (PD-old-auto-expired)，藏館 Cleveland Museum of Art。/' 畫/魚石圖卷.md

# 4e. A wikilink to a page this cut does not carry becomes its plain text.
python3 - <<'PY'
import re
from pathlib import Path
stems = {p.stem for p in Path(".").rglob("*.md")} | {p.name for p in Path(".").rglob("*") if p.is_dir()}
link = re.compile(r'(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]')
def fix(m):
    target, label = m.group(1), m.group(2)
    if target.rstrip("/").split("/")[-1] in stems or target == "/":
        return m.group(0)
    return label if label else target.rstrip("/").split("/")[-1]
for p in Path(".").rglob("*.md"):
    t = p.read_text(encoding="utf-8")
    n = link.sub(fix, t)
    if n != t:
        p.write_text(n, encoding="utf-8")
PY
