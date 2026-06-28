#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Driftly — pull-and-publish, run ON the REG.ru hosting (Shell-клиент).
# Pulls the latest commit from GitHub and copies docs/ into the live web root.
#
# One-time setup on the hosting (paste once in the Shell-клиент):
#   cd ~ && git clone https://github.com/adriaaante/shadow-user.git
#   echo 'WEBROOT=/home/uXXXXXXX/driftly.site/public_html' > ~/shadow-user/scripts/server-update.env
#
# Then update the live site any time with ONE command:
#   bash ~/shadow-user/scripts/server-update.sh
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/scripts/server-update.env" ] && . "$ROOT/scripts/server-update.env"
: "${WEBROOT:?set WEBROOT in scripts/server-update.env (e.g. /home/uXXXXXXX/driftly.site/public_html)}"

cd "$ROOT"
echo ">> git pull"
git pull --ff-only

echo ">> publish docs/ -> $WEBROOT"
mkdir -p "$WEBROOT"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude '.git' --exclude '.DS_Store' "$ROOT/docs/" "$WEBROOT/"
else
  # no rsync on this plan — clear and copy
  find "$WEBROOT" -mindepth 1 -delete
  cp -a "$ROOT/docs/." "$WEBROOT/"
fi
echo ">> Done. https://driftly.site/"
