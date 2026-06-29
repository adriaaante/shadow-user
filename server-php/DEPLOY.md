# Deploying the Driftly licensing server on REG.ru shared hosting (free)

Pure PHP 8 + MySQL + CRON — no Node, no VPS. The API lives at `https://api.driftly.site`.

## 1. MySQL database
Panel → **Базы данных** → create a DB + user. Note the **db name / user / password**.

## 2. Subdomain `api.driftly.site`
Panel → **Сайты** → add subdomain `api.driftly.site`:
- PHP version **8.2+**.
- Document root → the folder where this `server-php/` lands (see step 3).
- Enable **SSL** (Let's Encrypt), same as the main domain. T-Bank webhooks require HTTPS.

## 3. Upload the code
Easiest (Shell-клиент), reusing the git checkout:
```bash
cd ~ && git clone https://github.com/adriaaante/shadow-user.git driftly-src   # or: cd ~/driftly-src && git pull
```
Point the subdomain's document root to `~/driftly-src/server-php` (in the panel),
**or** symlink it: `ln -sfn ~/driftly-src/server-php ~/www/api.driftly.site`.

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
Panel → **Планировщик CRON** → add, every 10 minutes:
```
php /home/uXXXXXXX/driftly-src/server-php/tick.php >/dev/null 2>&1
```

## 7. Point the clients at the API
In both clients set the licensing API to `https://api.driftly.site`:
- Web: it reads `?api=` / the in-app field, or set `DEFAULT_API` in `docs/app/web-account.js`.
- Desktop: `DRIFTLY_LICENSE_API` env or the in-app field.
Once set, the apps leave demo mode and enforce the real trial / paywall / billing.

## 8. T-Bank merchant settings
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
