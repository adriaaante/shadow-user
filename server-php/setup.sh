#!/usr/bin/env bash
# One-time / repeatable server-php setup on the hosting Shell-клиент:
#   bash ~/driftly-src/server-php/setup.sh
# Does ALL the code-side work: pull latest, create .env from template, generate the
# license keypair, and print the two panel values you still need (docroot + CRON).
# (Creating the subdomain, SSL and CRON itself are panel actions — shared hosting
# has no provisioning API.)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"        # .../driftly-src/server-php
( cd "$DIR/.." && echo ">> git pull" && git pull --ff-only || true )

cd "$DIR"
if [ ! -f .env ]; then
  cp .env.example .env
  echo ">> created server-php/.env  — EDIT secrets next: nano $DIR/.env"
else
  echo ">> .env already present (left as-is)"
fi

if [ ! -f .keys/ec-private.pem ]; then
  php keygen.php
else
  echo ">> license keypair already present"
fi

# tables auto-create on first request; do a quick PHP sanity check of the DB if .env is filled
php -r 'require "lib/config.php"; require "lib/store.php"; try { Store::fromEnv(); echo ">> DB connection OK (tables ensured)\n"; } catch (Throwable $e) { echo ">> DB not reachable yet (fill .env): ".$e->getMessage()."\n"; }' || true

echo ""
echo "================ STILL TO DO IN THE PANEL (one-time) ================"
echo "1) Set the api.driftly.site site's КОРНЕВАЯ ДИРЕКТОРИЯ to:"
echo "      $DIR"
echo "2) Issue Let's Encrypt SSL for api.driftly.site (SSL-сертификаты)."
echo "3) Add a CRON job (every 10 min):"
echo "      php $DIR/tick.php >/dev/null 2>&1"
echo "4) Edit secrets:  nano $DIR/.env   (DB creds, T-Bank terminal; MAIL_FROM_* for php-mail)"
echo "===================================================================="
echo "Then verify:  curl https://api.driftly.site/v1/health"
