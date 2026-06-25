<div align="center">

# Driftly

**Keep your session alive — and measure it.**
Поддерживайте рабочую сессию активной — и измеряйте её.

A small, beautiful, free desktop app that generates *synthetic user activity* on a
schedule and **measures** activity with and without it — so you can benchmark it against
any external activity-monitoring tool. Local-only. No telemetry. No accounts.

</div>

---

## Repository layout

| Path        | What it is |
|-------------|------------|
| `PLAN.md`   | Master plan & architecture — the source of truth linking app + site |
| `app/`      | The Driftly desktop application (Electron, cross-platform) |
| `docs/`     | The marketing & download website (static, SEO-optimized, RU/EN) — also the GitHub Pages publish folder |
| `LICENSE`   | Proprietary license — all rights reserved to the owner |
| `PRIVACY.md`| Privacy statement — no data is collected |

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

## Responsible use

Driftly is intended for **automation, anti-idle, and testing/benchmarking on systems you
own or are authorized to use**. Do not use it to misrepresent activity on systems you are
not authorized to operate. You are responsible for complying with the policies and laws
that apply to you.

## License

Proprietary. **All rights reserved to the owner.** Free to download and use; redistribution
or modification is not permitted. See [`LICENSE`](./LICENSE).
