<div align="center">

# Driftly

**Keep your session alive — and measure it.**
Поддерживайте рабочую сессию активной — и измеряйте её.

A small, beautiful app that generates *synthetic user activity* on a schedule and
**measures** activity with and without it — so you can benchmark it against any external
activity-monitoring tool. Available as a **web app** (no install) and a **desktop app**,
unlocked by **one subscription** with a **3-day free trial**. Activity data is local-only —
no telemetry.

</div>

---

## Repository layout

| Path        | What it is |
|-------------|------------|
| `PLAN.md`   | Master plan & architecture — the source of truth linking everything |
| `app/`      | The Driftly desktop application (Electron, cross-platform) |
| `docs/`     | Marketing/download website **and** the no-install web app (`docs/app/`) — GitHub Pages publish folder |
| `shared/`   | Shared entitlement + license code (one source of truth for web, desktop, server) |
| `server/`   | Licensing & subscription backend (accounts, signed licenses, trial, payments) |
| `LICENSE`   | Proprietary license — all rights reserved to the owner |
| `PRIVACY.md`| Privacy statement — activity data is local; only email/billing when you subscribe |
| `TERMS.md`  | Subscription terms / public-offer template |

## What Driftly does

- **Generates activity** — humanized mouse movement, clicks, scroll (and optional safe
  keystrokes) so a workstation does not register as idle.
- **Activity level** — Gentle / Balanced / Energetic, or a custom 1–100 intensity.
- **Schedule** — working hours, weekdays, and one or more time ranges.
- **Measures & compares** — counts activity continuously and splits it two ways:
  - **Shadow mode** (Driftly is running) vs **Passive mode** (only the real human);
  - **synthetic** events vs **real** human events.
- **Exports** metrics to CSV / JSON so you can compare Driftly's numbers against an
  external program that measures the same activity.
- **Local-only** — nothing leaves your computer.

## Two ways to use Driftly

- **Desktop app** (`app/`) — full power: drives the real OS cursor and measures
  system-wide activity. Recommended for real benchmarking against an external tool.
- **No-install web app** (`docs/app/`) — runs in any modern browser, nothing to install.
  It simulates activity in an on-page sandbox, keeps the screen awake (Wake Lock), and
  measures activity **on the page** (Shadow vs Passive, synthetic vs real, CSV/JSON export).
  A browser cannot control the OS cursor or measure system-wide activity — that's the
  desktop app's job. Live at `…/app/` once GitHub Pages is enabled.

## Run the app (development)

```bash
cd app
npm install
npm start
```

Driftly runs even if the optional native input modules aren't installed — it falls back to
**simulation mode** so the full UI, scheduler, scoring, charts and exports still work.
To enable real input control + global monitoring, the optional native dependencies
(`@nut-tree-fork/nut-js`, `uiohook-napi`) are installed automatically when available for
your platform.

## Build installers

```bash
cd app
npm run dist     # electron-builder → Windows / macOS / Linux installers
```

Upload the artifacts to **GitHub Releases**; the website download buttons point there.

## Preview the website

```bash
cd docs
python3 -m http.server 8080   # then open http://localhost:8080
```

## Subscription (single subscription · web + desktop)

Driftly is a paid product with a **card-on-file 3-day free trial**. **One subscription, tied
to your email account, unlocks BOTH the web and desktop apps.** After the trial it renews
automatically; if a charge fails the apps show a **"необходимо оплатить"** paywall until paid.

The licensing/subscription backend lives in [`server/`](./server) and is fully runnable in
dev with mock payments. Payments plug into **T‑Bank (Tinkoff)** or **YooKassa (ЮKassa)**:

```bash
cd server
npm run keygen   # one-time: Ed25519 keypair (private stays local; public → shared/)
npm start        # http://localhost:8787  (mock provider)
npm test         # 17-step lifecycle test: trial → charge → past_due → retry → active
```

Until you deploy the server and point the clients at it, both apps run in **preview mode**
(open access + a banner). Set the API URL (in-app Subscription panel, `DRIFTLY_LICENSE_API`,
or `?api=` for the web app) to activate real gating. Card data is handled by the payment
provider — never by Driftly. See [`server/README.md`](./server/README.md), [`TERMS.md`](./TERMS.md)
and [`PRIVACY.md`](./PRIVACY.md).

## Responsible use

Driftly is intended for **automation, anti-idle, and testing/benchmarking on systems you
own or are authorized to use**. Do not use it to misrepresent activity on systems you are
not authorized to operate. You are responsible for complying with the policies and laws
that apply to you.

## License

Proprietary. **All rights reserved to the owner.** Free to download and use; redistribution
or modification is not permitted. See [`LICENSE`](./LICENSE).
