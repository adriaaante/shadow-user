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
- `server/` — licensing backend (Node http+crypto+fs, no deps): `index.js` (endpoints, auth, billing, auto-charge tick), `lib.js` (Ed25519 signing), `keygen.js`, `mailer.js` (email-code sender), `providers/{index,mock,tbank,yookassa}.js`, `test.js`, `README.md`.
- Docs: `PLAN.md` (architecture), `PRIVACY.md`, `TERMS.md` (offer template), `README.md`.

**Vendored (do not hand-edit as the source):** `app/src/shared/` and `docs/app/shared/` are
**copies** of `shared/` so each client packages self-contained. ⚠️ After editing `shared/*`,
recopy to both (see Commands), or clients run stale logic. `entitlement.js`, `license.js`,
`license-public.pem` go to app; `entitlement.js`, `license.js` go to web.

**Generated / not committed:** `server/.keys/` (private key), `server/.data/accounts.json`
(the store), `app/dist/` (installers), `config.json`/`metrics.json` (desktop runtime).

## Deploy / what actually ships
- **Site + web app:** static, **no build**. GitHub Pages from `docs/` (Settings → Pages →
  branch + `/docs`). Pushing the published branch updates it. Live: `…/` and `…/app/`.
- **Desktop:** `cd app && npm run dist` (electron-builder → Win/macOS/Linux installers) →
  upload to **GitHub Releases**; site download buttons point there. Native input modules are
  optional — without them the app runs in **simulation mode** (full UI still works).
- **Server:** NOT deployed yet. Reference Node server; deploy to a small host (Fly.io/Render
  free tier, or a cheap VPS). Set the licensing API URL in the clients to switch them off
  preview mode. Needs `npm run keygen` once + provider/mailer env (see server/README.md).

## Database — do you need one? (analyzed)
**You need durable server-side storage of billing state — but it is tiny and essentially free.**
Who-paid / until-when / cancelled cannot live on the client (forgeable) and can't be recomputed
on the fly, so *some* server persistence is required. **Card data is NOT stored — the payment
provider (T-Bank/YooKassa) holds it.** What we persist: `email → {status, trialEndsAt,
currentPeriodEnd, canceled, provider ids}` + sign-in codes + account tokens.

Three tiers (cheapest → most robust), pick by scale:
1. **Current: a JSON file** (`server/.data/accounts.json`), written **atomically** (temp+rename,
   so a crash can't corrupt it). Zero deps, zero cost. Correct for a **single server instance** at
   low/medium volume. ← fine to launch with.
2. **Embedded SQLite** (e.g. `better-sqlite3`) — still $0, still one file, but real transactions;
   move here if writes get frequent. Same single-instance assumption.
3. **Managed free-tier DB** (Cloudflare D1/KV, Turso, Supabase, Upstash) — needed only if you run
   **multiple server instances** or go serverless (a file can't be shared across instances).

You can lean further on the provider (they store subscriptions too), but you still need the local
`email ↔ customer-id` map + fast status lookups, so "no storage at all" is not viable. **Bottom
line: no expensive database; the JSON store is the no-cost default, upgrade path documented.**
The store shape is in `server/index.js` (`db = {accounts, tokens, codes}`); `publicAccount()`
defines the safe projection.

## Gotchas
- **Recopy `shared/` after editing** (see above) — the #1 footgun.
- **Preview mode:** clients with no licensing API set run open + a banner (usable pre-deploy).
  Setting the API activates real trial/paywall/past_due gating.
- **Paywall must not cover the subscription UI** — desktop hides it on the Subscription view;
  web makes it dismissable (CTA). The run-gate still enforces no-access regardless.
- **Keys:** only `shared/license-public.pem` is committed; `server/.keys/` is gitignored.
  Regenerating keys invalidates every issued token (clients must re-fetch).
- **Bilingual site:** every text node needs both `data-ru` and `data-en`.
- **Cancel keeps access** until period end (legal); cancelled-then-ended → `expired`, not `past_due`.
- Sign-in codes: single-use, 10-min expiry, 5-try lockout (`server/index.js`).

## Commands
- Server: `cd server && npm run keygen` (once) · `npm start` (:8787, mock) · `npm test` (22 checks: auth, trial→charge→past_due→retry, cancel/resume, multi-device, tamper).
- Recopy shared: `cp shared/entitlement.js shared/license.js shared/verify-node.js shared/license-public.pem app/src/shared/ && cp shared/entitlement.js shared/license.js docs/app/shared/`
- Desktop: `cd app && npm install && npm start` · `npm run dist` (installers).
- Site/web preview: `cd docs && python3 -m http.server 8080`.
- Browser e2e (dev-only, needs `playwright-core` + the headless-shell binary): drove the full web
  subscription flow; not committed (avoids adding a heavy test dep).
