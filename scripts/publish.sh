#!/usr/bin/env bash
# Publishes web/ to GitHub Pages (branch gh-pages) and a clickable sample-data demo at /demo/.
set -euo pipefail
cd "$(dirname "$0")/.."
URL=$(git remote get-url origin)
OUT=$(mktemp -d)
cp -R web/. "$OUT/"
mkdir "$OUT/demo" && cp -R web/. "$OUT/demo/" && cp demo-src/data.js "$OUT/demo/data.js"
# demo login hint + reset link; separate cache name
perl -pi -e 's#<div class="err" id="le">\$\{esc\(msg\)\}</div>#<div class="err" id="le">\${esc(msg)}</div><p style="font-size:12px;margin:0 0 12px">DEMO - sample data in your browser. Log in as <b>admin\@demo</b>, <b>manager\@demo</b> or <b>staff\@demo</b> with any password.</p>#' "$OUT/demo/app.js"
perl -pi -e "s#redeye-erp-v6#redeye-demo-v1#" "$OUT/demo/sw.js"
[ -n "${DRY_RUN:-}" ] && { echo "$OUT"; exit 0; }
cd "$OUT" && git init -q -b gh-pages && git add -A \
 && git -c user.name="Redeye Admin" -c user.email="redeye-erp@users.noreply.github.com" commit -q -m "Publish site + demo"
git push -q -f "$URL" gh-pages:gh-pages
echo "Published: site root + /demo/"
