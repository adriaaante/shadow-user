#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Driftly — one-command deploy of the site (docs/) to REG.ru hosting.
#
#   bash scripts/deploy.sh
#
# It mirrors the contents of docs/ to your hosting web root, so after any git
# change you just run:   git pull && bash scripts/deploy.sh
#
# Config: copy scripts/deploy.env.example -> scripts/deploy.env and fill it in
# (deploy.env is gitignored — it holds your host/login). Two methods:
#   DEPLOY_METHOD=ssh  -> rsync over SSH  (preferred; needs SSH access)
#   DEPLOY_METHOD=ftp  -> lftp mirror     (for FTP-only plans; needs DEPLOY_PASS)
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/docs/"
[ -f "$ROOT/scripts/deploy.env" ] && . "$ROOT/scripts/deploy.env"

: "${DEPLOY_HOST:?set DEPLOY_HOST (e.g. serverNNN.hosting.reg.ru)}"
: "${DEPLOY_USER:?set DEPLOY_USER (your hosting login, e.g. uNNNNNNN)}"
: "${DEPLOY_PATH:?set DEPLOY_PATH (web root, e.g. /home/uNNNNNNN/driftly.site/public_html)}"
DEPLOY_METHOD="${DEPLOY_METHOD:-ssh}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"

[ -d "$SRC" ] || { echo "ERROR: $SRC not found" >&2; exit 1; }
echo ">> Deploying $SRC"
echo ">> to        $DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH  (method: $DEPLOY_METHOD)"

case "$DEPLOY_METHOD" in
  ssh)
    command -v rsync >/dev/null || { echo "ERROR: rsync not installed" >&2; exit 1; }
    rsync -avz --delete --human-readable \
      -e "ssh -p $DEPLOY_PORT" \
      --exclude '.DS_Store' --exclude 'Thumbs.db' \
      "$SRC" "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"
    ;;
  ftp)
    command -v lftp >/dev/null || { echo "ERROR: lftp not installed (apt install lftp / brew install lftp)" >&2; exit 1; }
    : "${DEPLOY_PASS:?set DEPLOY_PASS for FTP method}"
    lftp -u "$DEPLOY_USER,$DEPLOY_PASS" "ftp://$DEPLOY_HOST" -e "
      set ftp:ssl-allow true; set ssl:verify-certificate no;
      mirror -R --delete --verbose --exclude-glob .DS_Store --exclude-glob Thumbs.db \
        '$SRC' '$DEPLOY_PATH';
      bye"
    ;;
  *)
    echo "ERROR: DEPLOY_METHOD must be 'ssh' or 'ftp' (got '$DEPLOY_METHOD')" >&2; exit 1;
    ;;
esac

echo ">> Done. Check https://driftly.site/"
