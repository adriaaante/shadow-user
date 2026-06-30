# Deploying the Driftly licensing server on REG.ru shared hosting (free)

Pure PHP 8 + MySQL + CRON — no Node, no VPS. The API lives at `https://api.driftly.site`.

## 1. MySQL database
Panel → **Базы данных** → create a DB + user. Note the **db name / user / password**.

## 2. Subdomain `api.driftly.site`
Panel → **Сайты** → add subdomain `api.driftly.site`:
- PHP version **8.2+**.
- Document root → keep the panel default (`~/www/api.driftly.site`); see step 3.
- Enable **SSL** (Let's Encrypt), same as the main domain. T-Bank webhooks require HTTPS.

## 3. Upload the code (real-directory docroot + thin shim)
Reuse the git checkout (Shell-клиент):
```bash
cd ~ && git clone https://github.com/adriaaante/shadow-user.git driftly-src   # or: cd ~/driftly-src && git pull
```
⚠️ **Do NOT make the docroot a symlink to `server-php`.** ISPmanager's Let's Encrypt
module does file operations in the docroot and fails on a symlink ("ошибка при работе с
файлами"), so the cert never issues. Keep the docroot a **real directory** holding a
one-line `index.php` shim that loads the real front controller (this also keeps `.env`
and `.keys/` outside the webroot — they can't be served at all):
```bash
SRC=~/driftly-src/server-php ; DOC=~/www/api.driftly.site
rm -f "$DOC"; mkdir -p "$DOC"
printf '<?php require %s;\n' "'$SRC/index.php'" > "$DOC/index.php"
cp "$SRC/.htaccess" "$DOC/.htaccess"
```
All code paths resolve via `__DIR__`, so the shim doesn't disturb `lib/`, `.env`, or `.keys/`.
On `git pull` the shim keeps pointing at the updated code — nothing to redo.

## 4. Configuration
```bash
cd ~/driftly-src/server-php
cp .env.example .env
nano .env     # fill DB_*, UNISENDER_GO_API_KEY, TBANK_* (terminal key/password), URLs
```

## 5. License keypair
```bash
php keygen.php          # writes .keys/ec-private.pem (secret) + prints the PUBLIC key
```
Copy the printed **PUBLIC key** into the clients and redeploy the site:
- replace `shared/license-public.pem` with it, then
  `cp shared/license-public.pem app/src/shared/` and `git commit`/`driftly-update` so
  `driftly.site` ships the matching key. (Desktop installers must be rebuilt to pick it up.)

## 6. CRON — recurring charges
Panel → **Планировщик CRON** → expert mode, every 10 minutes (`*/10 * * * *`). Use the
absolute `php` binary path — the shared host's CLI php is 8.x:
```
/usr/bin/php /home/uXXXXXXX/driftly-src/server-php/tick.php >/dev/null 2>&1
```
Tick "не отправлять отчёт по e-mail" so it doesn't mail you every 10 minutes.

## 7. Email for sign-in codes
**`DRIFTLY_MAILER=php-mail`** — free + self-contained: codes are sent as `MAIL_FROM_EMAIL`
(`support@driftly.site`) through the host's MTA via PHP `mail()`. No third-party service, no
ongoing cost. To keep codes out of spam:
- **Enable DKIM** for `driftly.site` in the panel (Почта → DKIM) — it adds a TXT record.
- Keep the host IP in **SPF** (`driftly.site` TXT: `v=spf1 ip4:37.140.192.157 a mx
  include:_spf.hosting.reg.ru ~all`), so the envelope sender passes SPF.
- Add a simple DMARC TXT at `_dmarc.driftly.site`: `v=DMARC1; p=none; rua=mailto:you@…`.
- Create the `support@driftly.site` mailbox in the panel (so From/Return-Path is a real local
  address).

## 8. Point the clients at the API
In both clients set the licensing API to `https://api.driftly.site`:
- Web: it reads `?api=` / the in-app field, or set `DEFAULT_API` in `docs/app/web-account.js`.
- Desktop: `DRIFTLY_LICENSE_API` env or the in-app field.
Once set, the apps leave demo mode and enforce the real trial / paywall / billing. Do this
only after (a) Unisender is out of `free_tier` and (b) the T-Bank cycle is validated —
otherwise live visitors hit a sign-in/paywall that can't complete. To test end-to-end before
flipping the default, append `?api=https://api.driftly.site` to the web app URL.

## 9. T-Bank merchant settings
In the Т-Касса shop set:
- **NotificationURL** = `https://api.driftly.site/v1/webhooks/tbank`
- **Success/Fail URL** = your `TBANK_SUCCESS_URL` / `TBANK_FAIL_URL`
Test on the **test terminal** first (the Init/Charge/webhook round-trips must be
validated live), then swap in the live terminal key/password.

## Verify
```bash
curl https://api.driftly.site/v1/health      # {"ok":true,"provider":"tbank","keys":true}
curl https://api.driftly.site/v1/config      # price 249 / 2500
```
Updating later: `cd ~/driftly-src && git pull` (CRON + API pick it up immediately).
