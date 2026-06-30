# Driftly licensing & subscription server

Reference implementation of the backend that powers Driftly's **single subscription across
the web and desktop apps**. It manages accounts and issues **Ed25519-signed license
tokens** that both clients verify, implements the **card-on-file 3-day free trial**, the
**automatic recurring charge**, and the **`past_due` blocked state** ("необходимо
оплатить"). Payments go through a pluggable provider: **mock**, **T‑Bank (Tinkoff)** or
**YooKassa (ЮKassa)**.

> Dependency-free Node (HTTP + crypto + fs). It's a reference: put a real database behind
> it and run it over HTTPS for production. Only account + billing state lives here —
> **activity data never leaves the user's device.**

## Quick start (dev, mock payments)

```bash
cd server
npm run keygen      # creates the Ed25519 keypair (private stays here; public → ../shared)
npm start           # http://localhost:8787   (provider: mock)
npm test            # full lifecycle test: trial → charge → past_due → retry → active
```

Then point a client at it:
- **Web app:** open `…/app/?api=http://localhost:8787` (or set the server URL in the
  Subscription panel). The `?api=` is remembered.
- **Desktop app:** Subscription → "Сервер лицензий" → enter the URL, or set
  `DRIFTLY_LICENSE_API=http://localhost:8787` before launching.

If no API is set, the clients run in **preview mode** (open access + a banner) so they're
usable before the server is deployed.

## How it works

```
client  ──POST /v1/account {email}──────────►  account + accountToken
client  ──POST /v1/billing/start-trial {card}─►  status=trialing, trialEndsAt=now+3d
                                                  (provider saves the card for autopay)
server tick (or /v1/billing/retry):
   trial ends → provider.chargeRecurring()
       success → status=active, currentPeriodEnd=now+30d
       failure → status=past_due   ← clients BLOCK with "необходимо оплатить"
client  ──GET /v1/license / /v1/status────────►  fresh Ed25519-signed token + entitlement
```

The desktop app **verifies the token offline** with the embedded public key
(`shared/license-public.pem`) so it is tamper-resistant and works within a 7-day offline
grace window; the web app trusts the HTTPS response and caches the token. Real access is
always bounded by `trialEndsAt` / `currentPeriodEnd`, so a token can never grant access
past those dates. The single source of truth for "what's unlocked" is
`shared/entitlement.js`, shared by the server and both clients.

## Endpoints

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /v1/health` | — | liveness + provider + keys present |
| `GET /v1/config` | — | provider, trial days, price |
| `POST /v1/auth/request` `{email}` | — | email a 6-digit sign-in code (passwordless) |
| `POST /v1/auth/verify` `{email,code}` | — | verify the code → `accountToken` |
| `GET /v1/license` | Bearer | issue a fresh signed license token |
| `GET /v1/status` | Bearer | account + license + entitlement |
| `POST /v1/billing/start-trial` `{card}` | Bearer | attach card, start the 3-day trial |
| `POST /v1/billing/retry` | Bearer | retry the charge (after `past_due`) |
| `POST /v1/billing/cancel` | Bearer | cancel — keeps access until period end, stops renewal |
| `POST /v1/billing/resume` | Bearer | undo a cancellation before the period ends |
| `POST /v1/webhooks/:provider` | provider sig | payment provider notifications |

### Authentication (passwordless email code)
Sign-in proves the user owns the email **before** any subscription is tied to it — so
signing in on another device (one account = one subscription across web + desktop) is
secure, and nobody can take over someone else's billing by typing their address. The
code is sent via `mailer.js` (dev default `console` logs it and returns it in the
response as `devCode`). Codes are single-use, expire in 10 minutes, and lock out after
5 wrong tries.

**Sending real codes.** The live deployment is the **PHP server** (`server-php/`), which sends
via host SMTP (`php-mail`) — no ESP, no cost. See `server-php/lib/mailer.php` + `DEPLOY.md`.
This Node server is the VPS reference; its `mailer.js` ships only the `console` backend — wire
your SMTP/ESP of choice as an extra `REGISTRY` entry for a Node/VPS deployment.

Whatever sends the mail, the sending domain (`driftly.site`) must have **SPF + DKIM + DMARC** set
so codes don't land in spam (a code in spam breaks login).

## Selecting a payment provider

Set env vars and restart:

```bash
# T-Bank (Tinkoff)
DRIFTLY_PROVIDER=tbank TBANK_TERMINAL_KEY=... TBANK_PASSWORD=... npm start

# YooKassa (ЮKassa)
DRIFTLY_PROVIDER=yookassa YOOKASSA_SHOP_ID=... YOOKASSA_SECRET_KEY=... npm start
```

If the chosen provider has no keys, the server falls back to **mock** and logs a warning.

### Wiring a real provider
`providers/tbank.js` and `providers/yookassa.js` implement the same interface as
`providers/mock.js` and contain step-by-step TODOs for the real HTTPS calls:

- **T‑Bank:** `Init` (first/trial payment with `Recurrent=Y` + `CustomerKey`) → store the
  `RebillId` from the notification → `Charge {PaymentId, RebillId}` for each autopay.
  Requests are signed with a SHA‑256 `Token` (already implemented in `makeToken`).
- **YooKassa:** create a payment with `save_payment_method=true` → store the returned
  `payment_method_id` → autopay with `{payment_method_id, capture:true}`.

Plug the API call where each TODO is, map the provider's webhook events to account status,
and the rest of the flow (trial, blocking, license issuance) already works.

## Storage — do you need a database?
**You need durable storage of billing state, but it's tiny and essentially free.** Who paid /
until when / cancelled can't be trusted to the client and can't be recomputed, so the server must
persist `email → {status, trialEndsAt, currentPeriodEnd, canceled, provider ids}` (+ sign-in codes
+ account tokens). **Card data is never stored here — the provider (T‑Bank/YooKassa) holds it.**

Storage is **embedded SQLite** (`server/store.js`) via Node's built-in **`node:sqlite`** — real
transactions + WAL durability, **zero external dependencies** (no native module to compile on the
host; requires **Node ≥ 22.5**). One file: `server/.data/driftly.db`. It prints a harmless
`ExperimentalWarning` (the API is stable in Node 24+).

1. **Embedded SQLite (current)** — $0, one file, transactional, durable. Correct for a **single
   instance** at low/medium volume.
2. **Managed free-tier DB** (Cloudflare D1/KV, Turso, Supabase, Upstash) — only if you run **multiple
   instances** or go serverless (one file can't be shared across instances).

To swap the store, reimplement `server/store.js` (same `getAccount/putAccount/emailForToken/
putToken/getCode/putCode/delCode` interface); nothing else changes. There is no cheaper path that
is still correct — a "no storage" design can't answer "is this email's subscription active?" securely.

## Security / production notes
- **Never commit `server/.keys/`** (the private key) — it's gitignored. Only the public key
  is committed.
- Replace the email-only sign-in with real auth (magic link / OTP) before launch.
- Run behind HTTPS; restrict CORS to your domains; move to a managed DB only if multi-instance.
- Back up `server/.data/driftly.db` (it holds all subscription state); on graceful shutdown SQLite
  checkpoints the WAL automatically.
- Verify webhook signatures (T‑Bank `Token`; for YooKassa, allowlist IPs + re-fetch the
  payment via the API).
