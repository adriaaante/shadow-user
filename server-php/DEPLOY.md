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
Billing model: the **3-day trial is free** — `startTrial` calls **AddCard** (CheckType=3DS,
a 0₽ card verification, NOT a charge) and stores the `RebillId` from the binding notification;
the **first real charge runs only when the trial ends** (`tick.php` → Charge by RebillId, day 4).
This needs the terminal set up for recurring + the URLs in the cabinet (AddCard, unlike Init,
does NOT take them per-request):
- Ask Т-Касса support to **enable рекуррентные платежи** for the terminal (otherwise AddCard/
  Charge return "Метод ... заблокирован для данного терминала").
- Set the terminal's **NotificationURL** = `https://api.driftly.site/v1/webhooks/tbank`.
- Set the terminal's **Success/Fail URL** = `https://driftly.site/app/?paid=1` / `?paid=0`.
Validate the AddCard→notification→Charge round-trips on the **test terminal** first (test card
`4300 0000 0000 0777`, 3-DS `12345678`), then swap in the live terminal key/password.

## Verify
```bash
curl https://api.driftly.site/v1/health      # {"ok":true,"provider":"tbank","keys":true}
curl https://api.driftly.site/v1/config      # price 199 / 1999
```
Updating later: `cd ~/driftly-src && git pull` (CRON + API pick it up immediately).

## Second product on the same hosting (multi-instance)
The server is product-agnostic: name, prices, trial length and email sender come from `.env`,
and every default equals the Driftly value (empty `.env` = Driftly, byte-for-byte). To ship
another product (e.g. «FutureFlow Маркетолог» 990/9990 ₽ or «FutureFlow Счета» 299/2990 ₽),
deploy a SECOND instance — instances share nothing:
1. **Own folder** — a separate checkout/copy, e.g. `~/futureflow-api/server-php` (each
   instance keeps its own `.env` and `.keys/` next to its `index.php`).
2. **Own MySQL DB** (Панель → Базы данных) — never share tables between products.
3. **Own subdomain + SSL** (e.g. `api.<product>.site`) with the same real-directory docroot
   + one-line shim as step 3 (shim `require` points into the instance folder).
4. **Own `.env`** — `cp .env.example .env`, fill `DB_*`, `TBANK_*` (its own terminal),
   URLs, `MAIL_FROM_EMAIL`/`MAIL_FROM_NAME`, and the product block:
   `PRODUCT_NAME=FutureFlow Маркетолог`, `PRICE_MONTHLY=990`, `PRICE_YEARLY=9990`
   (Счета: `299` / `2990`); `TRIAL_DAYS` only if it differs from 3.
5. **Own keypair** — `php keygen.php` in THAT folder (step 5). Never reuse Driftly's keys:
   each product's clients embed their own public key.
6. **Own CRON line** (step 6): `/usr/bin/php /home/uXXXXXXX/futureflow-api/server-php/tick.php`.
Verify with `curl https://api.<product>/v1/config` — it must return the product's name/prices.
Driftly's own `.env` needs no changes.

## Front-end (driftly.site) — deploy after changing `docs/`
The live `driftly.site` front is a **real-directory copy** on `u3544543@server135`, NOT a
symlink and NOT auto-updated by git — sync it from the checkout after every `docs/` change:
```bash
cd /var/www/u3544543/data/driftly-src && git pull --ff-only origin main
rsync -a --delete /var/www/u3544543/data/driftly-src/docs/ /var/www/u3544543/data/www/driftly.site/
curl -s https://driftly.site/app/web.js | grep -c function   # sanity check
```
(GitHub Pages `adriaaante.github.io/shadow-user/` updates on push by itself; the custom domain
does not — no `docs/CNAME`.)
