# CLAUDE.md — Driftly project memory

Per-repo playbook + memory. Read at session start; keep updated.

## Working rules (this session and beyond)
- Research best practice first for non-trivial work; compare 2–3 approaches, recommend one.
- Every changed line serves a requirement — no drive-by refactors, no "just in case" wrappers.
- Before adding a file, check the structure map below and reuse an existing place.
- Only fix reproducible bugs (input → expected → actual). Don't "improve" working code.
- Check impact before merge: who depends on this? contracts (API/token/entitlement shape) intact? run the tests.
- Don't pass unfinished work as done. State what's left.

## What this is
Driftly = "anti-idle + activity measurement" product, shipped as **two clients sharing one
subscription**: an **Electron desktop app** (`app/`) and a **no-install web app**
(`docs/app/`), plus a **marketing site** (`docs/`). A small **licensing/subscription server**
(`server/`) issues signed licenses and runs the card-on-file 3-day trial + recurring billing.
Stack: vanilla JS everywhere (no framework), Node for the server (zero runtime deps), Electron
for desktop. Bilingual RU/EN.

## Structure (map)
- `shared/` — **single source of truth**, plain UMD JS usable in Node + browser:
  - `entitlement.js` — access logic: `compute(license,now) → {access,blocked,reason,canceled,…}`. The ONE definition of free-trial/active/past_due/blocked.
  - `license.js` — JWT-like token codec (decode/encode only).
  - `verify-node.js` — Ed25519 verify (Node-only; desktop offline verify + server self-test).
  - `license-public.pem` — committed public key embedded in clients.
- `app/` — Electron desktop. Entry `src/main/index.js` (lifecycle, IPC, `reconcile()` drives the generator). Main modules: `store.js`, `metrics.js`, `monitor.js`, `generator.js`, `scheduler.js`, `input-backend.js`, `license.js` (subscription client, offline verify). Bridge: `src/preload/preload.js`. UI: `src/renderer/index.html` + `assets/app.js` + `app.css`.
- `docs/` — **GitHub Pages root**. `index.html` = marketing (bilingual, reveal-on-scroll, JSON-LD). `docs/app/` = web app: `index.html`, `web.js` (engine+UI), `web-account.js` (subscription client + `window.DriftlyGate`), `web.css`.
- `server/` — licensing backend (Node http+crypto, no external deps): `index.js` (endpoints, auth, billing, auto-charge tick), `store.js` (SQLite via built-in `node:sqlite`), `lib.js` (**ES256** signing), `keygen.js`, `mailer.js` (console + Unisender Go), `providers/{index,mock,tbank,yookassa}.js`, `test.js`, `README.md`. Reference/VPS option.
- `server-php/` — **the actual deployment target** (free, runs on REG shared hosting: PHP 8 + MySQL + CRON, no Node). Same API/JSON as `server/` so clients are unchanged. `index.php` (front controller, all `/v1/*`), `lib/{config,store(PDO),entitlement,jwt(ES256/openssl),license,mailer(Unisender Go),providers/{mock,tbank}}.php`, `keygen.php` (EC P-256), `tick.php` (CRON recurring-charge), `.htaccess`, `test.php` (14 checks), `.env.example`, `DEPLOY.md`. Tested locally on PHP 8.4 (SQLite) + e2e via `php -S` (20 checks). **`.keys/` and `.env` are gitignored.** ⚠️ T-Bank Init/Charge/webhook round-trips still need live validation on the test terminal.
- Docs: `PLAN.md` (architecture), `PRIVACY.md`, `TERMS.md` (offer template), `README.md`.

**Vendored (do not hand-edit as the source):** `app/src/shared/` and `docs/app/shared/` are
**copies** of `shared/` so each client packages self-contained. ⚠️ After editing `shared/*`,
recopy to both (see Commands), or clients run stale logic. `entitlement.js`, `license.js`,
`license-public.pem` go to app; `entitlement.js`, `license.js` go to web.

**Generated / not committed:** `server/.keys/` (private key), `server/.data/driftly.db`
(+`-wal`/`-shm`, the SQLite store), `app/dist/` (installers), `config.json`/`metrics.json` (desktop runtime).

## Deploy / what actually ships
- **Site + web app:** static, **no build**. GitHub Pages from `docs/` (Settings → Pages →
  branch + `/docs`). Pushing the published branch updates it. Live: `…/` and `…/app/`.
- **Desktop:** `cd app && npm run dist` (electron-builder → Win/macOS/Linux installers) →
  upload to **GitHub Releases**; site download buttons point there. Native input modules are
  optional — without them the app runs in **simulation mode** (full UI still works).
- **Server:** deploy **`server-php/`** to the REG shared hosting (PHP 8 + MySQL + CRON) —
  free, no VPS. Steps in `server-php/DEPLOY.md`: MySQL DB, `api.driftly.site` subdomain + SSL,
  `.env`, `php keygen.php` (→ replace `shared/license-public.pem` with the printed key + recopy
  + redeploy clients), CRON `php tick.php`. Then point clients at `https://api.driftly.site`
  to leave preview/demo mode. (`server/` Node remains a reference / VPS option.)
- **License signing is ES256 (ECDSA P-256)** via openssl/Node crypto — raw R||S (ieee-p1363),
  verified by `shared/verify-node.js`. (Switched from Ed25519 because the host lacks sodium.)

## Database — embedded SQLite (analyzed; cheap, durable)
**Billing state must be persisted server-side** — who paid / until when / cancelled can't live on
the forgeable client and can't be recomputed. It's stored in **embedded SQLite** via Node's
built-in **`node:sqlite`** (`server/store.js`): real transactions + WAL durability, **zero external
deps** (no native module to compile on the host; requires Node ≥ 22.5). One file:
`server/.data/driftly.db`. **Card data is NEVER stored — the provider (T-Bank/YooKassa) holds it.**
Persisted: `email → account JSON {status, trialEndsAt, currentPeriodEnd, canceled, provider ids}`,
sign-in codes, account tokens. Tables: `accounts(email,data)`, `tokens(token,email)`,
`codes(email,hash,exp,tries)`.

Why not `better-sqlite3`? It's a native module (compile/prebuilt on the host). `node:sqlite` is
built in → simpler deploy, same synchronous API. Scale path: SQLite is correct for a **single
instance**; move to a **managed free-tier DB** (Cloudflare D1/KV, Turso, Supabase, Upstash) ONLY if
you run multiple instances or go serverless (one file can't be shared). To swap, reimplement
`server/store.js` — the rest calls it via `store.{getAccount,putAccount,emailForToken,…}`.
Note: `node:sqlite` prints an ExperimentalWarning (harmless; stable in Node 24+).

## Gotchas
- **Recopy `shared/` after editing** (see above) — the #1 footgun.
- **REG docroot must be a REAL dir, not a symlink** (`server-php/DEPLOY.md` step 3). ISPmanager's
  Let's Encrypt does file ops in the docroot and fails on a symlink ("ошибка при работе с файлами").
  Use a real `~/www/api.driftly.site` holding a one-line `index.php` shim (`<?php require '…/server-php/index.php';`)
  + a copy of `.htaccess`. Bonus: `.env`/`.keys/` stay outside the webroot. Code resolves all paths via `__DIR__`.
- **nginx serves the ACME challenge itself** (`/.well-known/acme-challenge/` → `alias /usr/local/mgr5/www/letsencrypt/`),
  so HTTP-01 doesn't touch our docroot. The self-signed cert at site creation is replaced by LE once issued.
- **Email default is `php-mail`** (hosting SMTP via PHP `mail()`, `server-php/lib/mailer.php`) — free +
  self-contained, sends as `support@driftly.site` through the host MTA. Needs **DKIM enabled in the panel**
  + host IP in SPF (already present) so codes don't hit spam; create the `support@driftly.site` mailbox.
  Chosen over Unisender Go because UG's only *forever-free* tier sends to **own domains only** (external →
  code 903) and its paid promo lasts 2 months. UG remains a `DRIFTLY_MAILER=unisender-go` option (better RU
  deliverability, paid): node-pinned, ours is **go2** (`UNISENDER_GO_API_URL`); wrong node → code 114.
- **CRON uses `/usr/bin/php`** (CLI is 8.2) — `*/10 * * * * /usr/bin/php …/server-php/tick.php >/dev/null 2>&1`.
- **Preview mode:** clients with no licensing API set run open + a banner (usable pre-deploy).
  Setting the API activates real trial/paywall/past_due gating.
- **Paywall must not cover the subscription UI** — desktop hides it on the Subscription view;
  web makes it dismissable (CTA). The run-gate still enforces no-access regardless.
- **Keys:** only `shared/license-public.pem` is committed; `server/.keys/` is gitignored.
  Regenerating keys invalidates every issued token (clients must re-fetch).
- **Bilingual site:** every text node needs both `data-ru` and `data-en`.
- **Cancel keeps access** until period end (legal); cancelled-then-ended → `expired`, not `past_due`.
- Sign-in codes: single-use, 10-min expiry, 5-try lockout (`server/index.js`).
- **Device cap (anti-sharing):** one account unlocks at most `MAX_DEVICES` (default 2,
  env-overridable) — web + desktop. Each sign-in = one row in `tokens`; a new sign-in
  beyond the cap evicts the oldest (sliding window, ordered by SQLite rowid) so a license
  can't be shared around. `/v1/auth/signout` deletes the presented token to free a seat;
  both clients call it on sign-out. Note the 7-day offline license grace (`lib.js` exp) —
  an evicted device keeps cached access until that expires.

## Commands
- Server: `cd server && npm run keygen` (once) · `npm start` (:8787, mock) · `npm test` (26 checks: auth, trial→charge→past_due→retry, cancel/resume, multi-device, device cap + sign-out, tamper, SQLite durability).
- Recopy shared: `cp shared/entitlement.js shared/license.js shared/verify-node.js shared/license-public.pem app/src/shared/ && cp shared/entitlement.js shared/license.js docs/app/shared/`
- Desktop: `cd app && npm install && npm start` · `npm run dist` (installers).
- Site/web preview: `cd docs && python3 -m http.server 8080`.
- Browser e2e (dev-only, needs `playwright-core` + the headless-shell binary): drove the full web
  subscription flow; not committed (avoids adding a heavy test dep).
