# CLAUDE.md — Driftly project memory

Per-repo playbook + memory. Read at session start; keep updated.

## Working rules (this session and beyond)
- Research best practice first for non-trivial work; compare 2–3 approaches, recommend one.
- Every changed line serves a requirement — no drive-by refactors, no "just in case" wrappers.
- Before adding a file, check the structure map below and reuse an existing place.
- Only fix reproducible bugs (input → expected → actual). Don't "improve" working code.
- Check impact before merge: who depends on this? contracts intact? run the tests.
- Don't pass unfinished work as done. State what's left.

## What this is
Driftly = "anti-idle + activity measurement" product, **completely free**, shipped as **two
clients**: an **Electron desktop app** (`app/`) and a **no-install web app** (`docs/app/`), plus
a **marketing site** (`docs/`). **No accounts, no subscription, no payment, no server** — every
feature is open to everyone and all data stays local. Stack: vanilla JS everywhere (no
framework), Electron for desktop. Bilingual RU/EN on the site + web app.

> **History:** Driftly used to be a paid product (card-on-file 3-day trial + recurring T-Bank
> billing, an ES256 licensing server in `server-php/`, a `shared/` entitlement layer, and
> `server/` reference backend). All of that was **removed** when the product went free — the
> licensing server, `shared/`, the subscription UI, paywalls, and the oferta were deleted. Do
> NOT reintroduce a subscription/paywall/licensing path. If you find a lingering reference to
> billing/trial/subscription/oferta, it's a leftover to clean up.

## Structure (map)
- `app/` — Electron desktop. Entry `src/main/index.js` (lifecycle, IPC, `reconcile()` drives the generator). Main modules: `store.js`, `metrics.js`, `monitor.js`, `generator.js`, `scheduler.js`, `input-backend.js`. Bridge: `src/preload/preload.js`. UI: `src/renderer/index.html` + `assets/app.js` + `app.css`. The generator runs purely by run mode (`off` / `always` / `schedule`) — no license/access gate anywhere.
- `docs/` — **GitHub Pages root**. `index.html` = marketing (bilingual, reveal-on-scroll, JSON-LD). `docs/app/` = web app: `index.html`, `web.js` (engine+UI), `web.css`, `sw.js` (PWA offline shell). **Single screen, no tabs** — the run button just starts/stops the in-page generator (no gate). `docs/legal/privacy.html` is the only legal page (no oferta).
- Docs: `PLAN.md` (architecture), `PRIVACY.md`, `TERMS.md` (short free-use terms), `README.md`.
- `scripts/` — front-end deploy tooling (`deploy.sh` = rsync `docs/` to the REG host; `server-update.sh` = pull-and-publish `docs/` on the host). `*.env` are gitignored.

**Generated / not committed:** `app/release/` (installers), `config.json`/`metrics.json` (desktop runtime), `docs/app/` localStorage in the browser.

## Deploy / what actually ships
- **Hosting (REG):** `driftly.site` (front + web app) lives on **`u3544543` @ `server135`**, git
  checkout at `/var/www/u3544543/data/driftly-src`, docroot `/var/www/u3544543/data/www/driftly.site`.
  (There is no longer an `api.driftly.site` — the licensing server was removed.)
- **Site + web app:** static, **no build** (`docs/`). Deployed in TWO places:
  1. **GitHub Pages** — auto-updates on every push to `main`; URL `adriaaante.github.io/shadow-user/`.
  2. **The LIVE domain `driftly.site` is REG-hosted** (nginx) — NOT updated by git push; sync from
     `docs/` after pulling the checkout: on server135 `cd /var/www/u3544543/data/driftly-src &&
     git pull --ff-only origin main && rsync -a --delete .../docs/ .../www/driftly.site/`
     (or run `bash scripts/server-update.sh`). Custom domain is on REG, not Pages (no `docs/CNAME`).
- **Desktop:** `cd app && npm run dist` (electron-builder → Win/macOS/Linux installers) →
  upload to **GitHub Releases**; site download buttons point there. The two native modules —
  `@nut-tree-fork/nut-js` (real cursor/click/scroll/Alt+Tab) and `uiohook-napi` (global monitor
  that separates real vs synthetic input) — **must ship**, or the app falls back to «Симуляция» +
  «Только синтетика» (no cursor movement, `реальные (вы): 0`). They are N-API **prebuilts**. Build
  requirements, all load-bearing: (1) install WITHOUT `--omit=optional`; (2) `build.files` must
  include `node_modules/**/*`; (3) `build.asarUnpack` must unpack `node_modules/@nut-tree-fork/**`
  + `node_modules/uiohook-napi/**` (native `.node` can't load from inside asar); (4) `npmRebuild:false`.

## Gotchas
- **No subscription/licensing anymore.** The generator runs on run mode alone (desktop) or the
  run button alone (web). Don't add access gates, paywalls, trials, or an account/email flow.
- **Desktop window-switching (opt-in):** the generator can Alt+Tab/Cmd+Tab between open programs +
  minimize/restore so the monitor visibly changes (`input-backend.switchWindow/minimizeWindow`,
  `generator` `window` action). Off by default (`generator.switchWindows`), UI toggle «Переключать
  окна»; needs the native input backend (no-op in simulation mode) and respects `pauseOnUser`. The
  **web** app can't do this (browser sandbox) — it only animates its own in-page sandbox.
- **Desktop keep-awake:** OS-level `powerSaveBlocker` (`prevent-display-sleep` + `prevent-app-suspension`),
  re-asserted on a 20s watchdog, plus an F15 anti-idle nudge (real backend, after ~25s idle) and
  `backgroundThrottling:false` — the screen stays awake even minimized while the generator runs.
- **Bilingual site + web app:** every text node needs both `data-ru` and `data-en`. The language
  pref key is **`driftly.lang`** (site.js also writes legacy `driftly-lang` for old visitors).
- **docs/app/sw.js is network-first for js/css/html** (cache-first would pin old code on returning
  users of this no-build site). Bump `CACHE` only on breaking asset renames (currently `driftly-web-v3`).
- **og-image must stay a real PNG** (`docs/assets/img/og.png`, 1200×630) — social crawlers don't
  render SVG. Regenerate from `og.svg` via headless chromium if the design changes (same for `apple-touch-icon.png`).
- **REG docroot must be a REAL dir, not a symlink** — ISPmanager's Let's Encrypt does file ops in
  the docroot and fails on a symlink. `server-update.sh` refuses to publish into the home dir or the
  shared `www/` parent (would `--delete` other sites).

## Commands
- Desktop: `cd app && npm install && npm start` · `npm run dist` (installers) · `npm run check` (syntax).
- Site/web preview: `cd docs && python3 -m http.server 8080`.
- **Deploy front-end to live `driftly.site`** (on `u3544543@server135`, after pushing to `main`):
  `cd /var/www/u3544543/data/driftly-src && git pull --ff-only origin main && rsync -a --delete /var/www/u3544543/data/driftly-src/docs/ /var/www/u3544543/data/www/driftly.site/`
  (or `bash scripts/server-update.sh`; verify: `curl -s https://driftly.site/app/web.js | grep -c function`). GitHub Pages updates on push by itself.
- Web app headless boot check (dev): serve `docs/`, load `/app/` in chromium `--headless=new`, confirm
  `#rates` is populated (JS ran) and no `Uncaught`/`ReferenceError` in stderr.
