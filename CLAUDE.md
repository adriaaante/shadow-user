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
- `docs/` — **GitHub Pages root**. `index.html` = marketing (bilingual, reveal-on-scroll, JSON-LD). `docs/app/` = web app: `index.html`, `web.js` (engine+UI), `web-account.js` (subscription client + `window.DriftlyGate`), `web.css`. **Two tabs only: «Приложение» · «Подписка»** — sign-in/out (email→code, «Выйти») lives at the TOP of the Subscription card (`#sub-auth`), above the plan; there is no separate «Аккаунт» tab (merged, since managing a subscription requires being signed in).
- `server/` — licensing backend (Node http+crypto, no external deps): `index.js` (endpoints, auth, billing, auto-charge tick), `store.js` (SQLite via built-in `node:sqlite`), `lib.js` (**ES256** signing), `keygen.js`, `mailer.js` (console; prod email is `php-mail` in server-php), `providers/{index,mock,tbank}.js`, `test.js`, `README.md`. Reference/VPS option.
- `server-php/` — **the actual deployment target** (free, runs on REG shared hosting: PHP 8 + MySQL + CRON, no Node). Same API/JSON as `server/` so clients are unchanged. `index.php` (front controller, all `/v1/*`), `lib/{config,store(PDO),entitlement,jwt(ES256/openssl),license,mailer(php-mail host SMTP),providers/{mock,tbank}}.php`, `keygen.php` (EC P-256), `tick.php` (CRON recurring-charge), `.htaccess`, `test.php` (14 checks), `.env.example`, `DEPLOY.md`. Tested locally on PHP 8.4 (SQLite) + e2e via `php -S` (20 checks). **`.keys/` and `.env` are gitignored.** Billing: the **3-day trial is FREE but card-verified and ONCE per account (email), ever** — `startTrial` branches on `trialUsed` (a persisted `trialEndsAt` marks pre-flag legacy accounts as used): **first time** → `pending`+`pendingTrial`, T-Bank **Init {Recurrent:Y, ~1 ₽, OrderId `trial-…`}** (NOT AddCard — it returns no RebillId on this acquirer); the ~1 ₽ is refunded (Cancel, idempotent via `refundedPaymentId`) and the trial activates via webhook or `confirm-card`; **returning** → `pending`+`pendingPaid`, Init for the **FULL period (OrderId `sub-…`)**, activates `active` (no trial, no refund). `pendingPaymentId`+`pendingInterval` snapshot the payment at Init: `confirm-card` activates ONLY if that exact payment is CONFIRMED (a ~1 ₽ attach payment must never stand in for a full charge), and the paid period length uses the snapshot interval (plan-switch while pending can't stretch it). First real charge day 4 / renewals: `tick.php` (flock-guarded vs overlapping CRON) → Charge by RebillId (OrderId `renew-…`; webhook only flags REJECTED→past_due). `/v1/billing/retry` is guarded: allowed only when a charge is DUE (past_due, or trial/period elapsed). `attach-card` = ~1 ₽ verify that never touches the trial/period; while `pending` it re-issues the pending payment instead. ⚠️ Recurrent methods need рекуррент enabled on the terminal + NotificationURL/SuccessURL set in the Т-Касса cabinet.
- Docs: `PLAN.md` (architecture), `PRIVACY.md`, `TERMS.md` (offer template), `README.md`.

**Vendored (do not hand-edit as the source):** `app/src/shared/` and `docs/app/shared/` are
**copies** of `shared/` so each client packages self-contained. ⚠️ After editing `shared/*`,
recopy to both (see Commands), or clients run stale logic. `entitlement.js`, `license.js`,
`license-public.pem` go to app; `entitlement.js`, `license.js` go to web.

**Generated / not committed:** `server/.keys/` (private key), `server/.data/driftly.db`
(+`-wal`/`-shm`, the SQLite store), `app/dist/` (installers), `config.json`/`metrics.json` (desktop runtime).

## Deploy / what actually ships
- **Hosting accounts (REG):** the Driftly stack lives on **`u3544543` @ `server135`** — both
  `driftly.site` (front + web app) and the `api.driftly.site` subdomain, git checkout at
  `/var/www/u3544543/data/driftly-src`, site docroots under `/var/www/u3544543/data/www/`.
  (A second REG account `u3501870` @ `server292` hosts unrelated sites — not Driftly.)
- **Site + web app:** static, **no build** (`docs/`). Deployed in TWO places, keep both in mind:
  1. **GitHub Pages** — auto-updates on every push to `main`; URL `adriaaante.github.io/shadow-user/`.
  2. **The LIVE domain `driftly.site` is REG-hosted** (nginx) at `/var/www/u3544543/data/www/driftly.site`
     — this copy is **NOT** updated by a git push; it must be **synced from `docs/`** after pulling
     the checkout (deploy step in `server-php/DEPLOY.md`). The custom domain is on REG, not Pages
     (no `docs/CNAME`). So after changing `docs/`: push → `git pull` on server135 → sync into the
     `driftly.site` docroot.
- **Desktop:** `cd app && npm run dist` (electron-builder → Win/macOS/Linux installers) →
  upload to **GitHub Releases**; site download buttons point there. The two native modules —
  `@nut-tree-fork/nut-js` (real cursor/click/scroll/Alt+Tab) and `uiohook-napi` (global monitor
  that separates real vs synthetic input) — **must ship**, or the app falls back to «Симуляция» +
  «Только синтетика» (no cursor movement, `реальные (вы): 0`). They are N-API **prebuilts** (no
  compiler needed). Build requirements, all three are load-bearing: (1) install WITHOUT
  `--omit=optional`; (2) `build.files` must include `node_modules/**/*`; (3) `build.asarUnpack`
  must unpack `node_modules/@nut-tree-fork/**` + `node_modules/uiohook-napi/**` (native `.node`
  can't load from inside asar); (4) `npmRebuild:false` (N-API prebuilts load in Electron as-is).
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
`server/.data/driftly.db`. **Card data is NEVER stored — the provider (T-Bank) holds it.**
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
- **Desktop window-switching (opt-in):** the generator can Alt+Tab/Cmd+Tab between open programs +
  minimize/restore so the monitor visibly changes (`input-backend.switchWindow/minimizeWindow`,
  `generator` `window` action). Off by default (`generator.switchWindows`), UI toggle «Переключать
  окна»; needs the native input backend (no-op in simulation mode) and respects `pauseOnUser`. The
  **web** app can't do this (browser sandbox) — it only animates its own in-page sandbox.
- **REG docroot must be a REAL dir, not a symlink** (`server-php/DEPLOY.md` step 3). ISPmanager's
  Let's Encrypt does file ops in the docroot and fails on a symlink ("ошибка при работе с файлами").
  Use a real `~/www/api.driftly.site` holding a one-line `index.php` shim (`<?php require '…/server-php/index.php';`)
  + a copy of `.htaccess`. Bonus: `.env`/`.keys/` stay outside the webroot. Code resolves all paths via `__DIR__`.
- **nginx serves the ACME challenge itself** (`/.well-known/acme-challenge/` → `alias /usr/local/mgr5/www/letsencrypt/`),
  so HTTP-01 doesn't touch our docroot. The self-signed cert at site creation is replaced by LE once issued.
- **Email = `php-mail`** (hosting SMTP via PHP `mail()`, `server-php/lib/mailer.php`) — free +
  self-contained, sends as `support@driftly.site` through the host MTA. Needs **DKIM enabled in the panel**
  + host IP in SPF + a simple `_dmarc` TXT so codes don't hit spam; create the `support@driftly.site` mailbox.
  Chosen over Unisender Go (its forever-free tier sends to **own domains only**; external → code 903) and
  over an ESP generally — host SMTP costs nothing and needs no third party. Tested: code reached Gmail inbox.
- **CRON uses `/usr/bin/php`** (CLI is 8.2) — `*/10 * * * * /usr/bin/php …/server-php/tick.php >/dev/null 2>&1`.
- **Preview mode:** clients with no licensing API set run open + a banner (usable pre-deploy).
  Setting the API activates real trial/paywall/past_due gating.
- **Paywall must not cover the subscription UI** — desktop hides it on the Subscription view;
  web makes it dismissable (CTA). The run-gate still enforces no-access regardless.
- **Keys:** only `shared/license-public.pem` is committed; `server/.keys/` is gitignored.
  Regenerating keys invalidates every issued token (clients must re-fetch).
- **Bilingual site:** every text node needs both `data-ru` and `data-en`. The language pref key is **`driftly.lang`** everywhere (site.js keeps writing legacy `driftly-lang` for old visitors).
- **One free trial per account — invariant.** Enforced server-side (`trialUsed` + legacy `trialEndsAt`); legal texts (oferta §1/§3, TERMS.md, pricing fineprints) disclose it, and both clients swap the «3 дня бесплатно» button/paywall copy for «Оформить подписку» when `account.trialUsed`. Don't reintroduce an unconditional trial path.
- **docs/app/sw.js is network-first for js/css/html** (cache-first would pin old code on returning users of this no-build site). Bump `CACHE` only on breaking asset renames.
- **og-image must stay a real PNG** (`docs/assets/img/og.png`, 1200×630) — social crawlers don't render SVG. Regenerate from `og.svg` via headless chromium if the design changes (same for `apple-touch-icon.png`).
- **Cancel keeps access** until period end (legal); cancelled-then-ended → `expired`, not `past_due`.
- Sign-in codes: single-use, **5-min expiry**, 5-try lockout. TTL is defined in THREE places that must stay in sync: `server-php/index.php` (`AUTH_CODE_TTL_MS`, the live backend), `server/index.js` (`AUTH_CODE_TTL`, reference), and the web client `docs/app/web-account.js` (`CODE_TTL` — drives the on-screen countdown AND blocks sign-in once it elapses). The email text (`server-php/lib/mailer.php`) also states the duration. Mismatch = the "timer expired but the old code still worked" bug.
- **Device cap (anti-sharing):** one account unlocks at most `MAX_DEVICES` (default 2,
  env-overridable) — web + desktop. Each sign-in = one row in `tokens`; a new sign-in
  beyond the cap evicts the oldest (sliding window, ordered by SQLite rowid) so a license
  can't be shared around. `/v1/auth/signout` deletes the presented token to free a seat;
  both clients call it on sign-out. Note the 7-day offline license grace (`lib.js` exp) —
  an evicted device keeps cached access until that expires.

## Commands
- Server (Node reference): `cd server && npm run keygen` (once) · `npm start` (:8787, mock) · `npm test` — ⚠️ delete `server/.data/driftly.db*` first (the suite reuses the store; a second run makes alice a "returning" user and trial checks fail) · 2 known failures remain (Ed25519 verify vs ES256 keys — reference-only, the live PHP signs/verifies ES256 fine).
- Server (PHP, live): `cd server-php && php test.php` (14 checks). Billing e2e harnesses (fake T-Bank + `php -S`) live in the session scratchpad, not committed: unit 22 + e2e 34 + adversarial e2e 30 checks (legacy trial, attach-during-pending, interval-switch-while-pending, replayed webhooks, retry guard, refund idempotency).
- Recopy shared: `cp shared/entitlement.js shared/license.js shared/verify-node.js shared/license-public.pem app/src/shared/ && cp shared/entitlement.js shared/license.js docs/app/shared/`
- Desktop: `cd app && npm install && npm start` · `npm run dist` (installers).
- Site/web preview: `cd docs && python3 -m http.server 8080`.
- **Deploy front-end to live `driftly.site`** (on `u3544543@server135`, after pushing to `main`):
  `cd /var/www/u3544543/data/driftly-src && git pull --ff-only origin main && rsync -a --delete /var/www/u3544543/data/driftly-src/docs/ /var/www/u3544543/data/www/driftly.site/`
  (verify: `curl -s https://driftly.site/app/web.js | grep -c function`). GitHub Pages updates on push by itself.
- Browser e2e (dev-only, needs `playwright-core` + the headless-shell binary): drove the full web
  subscription flow; not committed (avoids adding a heavy test dep).
