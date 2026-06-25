# Driftly — Master Plan & Architecture

> **Driftly** is the product name chosen for the "shadow-user" concept.
> Tagline (RU): «Поддерживайте рабочую сессию активной — и измеряйте её».
> Tagline (EN): "Keep your session alive — and measure it."

This document is the single source of truth that connects the **desktop program**
and the **marketing/download website**. Both live in this repository (`shadow-user`).

---

## 1. What we are building

Two deliverables, one brand:

1. **Driftly (desktop app)** — a small, beautiful, free desktop application that:
   - generates *synthetic user activity* (mouse movement, clicks, scroll, optional safe
     keystrokes) on a configurable schedule, so a workstation does not register as idle;
   - lets the user set an **activity level** (Gentle / Balanced / Energetic / custom),
     **working hours**, **weekdays**, and one or more **time ranges**;
   - **measures activity** continuously, in two modes that can be compared:
     - **Shadow mode** — Driftly is generating activity;
     - **Passive mode** — Driftly only watches the real human's input;
   - separates **synthetic** vs **real** input so the two can be compared side by side;
   - is **local-only**: no telemetry, no accounts, no data leaves the machine.

2. **Driftly website** — a fast, SEO-optimized, bilingual (RU primary / EN) landing &
   download site that explains the product, shows an animated live demo of how it works,
   and links to downloads (GitHub Releases).

### Primary purpose (as specified by the owner)
The app exists to **benchmark another activity-measurement program**: run Driftly to produce
controlled, known synthetic activity, let the external program measure it, then **compare**
Driftly's own measurements against the external tool's results. Driftly therefore both
*produces* activity and *measures* it, and exports its metrics (CSV/JSON) for comparison.

---

## 2. Why a desktop app (not a browser extension)

A browser extension is sandboxed: it cannot move the OS cursor, click outside the page,
or measure *system-wide* real-user activity. The core requirements — driving the real
input devices and measuring activity **with and without** the generator across the whole
OS — require OS-level access. Therefore Driftly is a cross-platform **Electron** desktop
app (Windows / macOS / Linux).

---

## 3. Architecture (program)

```
app/
├─ package.json                Electron app manifest, scripts, electron-builder config
├─ src/
│  ├─ main/                    Main process (Node, full OS access)
│  │  ├─ index.js              Lifecycle, window, tray, IPC wiring, single source of truth
│  │  ├─ store.js              Local persistence (config + rolling metrics) — JSON on disk
│  │  ├─ input-backend.js      Pluggable backend: real (nut-js) OR simulation fallback
│  │  ├─ generator.js          Synthetic activity engine (humanized), driven by level
│  │  ├─ monitor.js            Global input monitor (uiohook-napi) OR self-report fallback
│  │  ├─ metrics.js            Per-minute activity scoring; synthetic vs real; shadow vs passive
│  │  └─ scheduler.js          Working hours / weekdays / time ranges → enable/disable engine
│  ├─ preload/preload.js       Safe contextBridge API (renderer ⇄ main)
│  └─ renderer/                UI (no network; brand-matched dark theme)
│     ├─ index.html            App shell + views
│     ├─ assets/theme.css      Design tokens shared with the website
│     ├─ assets/app.css        App-specific styles
│     ├─ assets/chart.js       Tiny dependency-free canvas charts
│     └─ assets/app.js         View logic, IPC calls, live updates
└─ build/                      Icons + packaging assets
```

### Data flow (the logical spine)

```
            ┌──────────────── main process ────────────────┐
 scheduler ─┤ decides if "now" is inside a working window   │
            │            │ enable/disable                   │
 generator ─┤◄───────────┘ emits synthetic input ──────────►│ input-backend ──► OS
            │                                                │
 monitor   ─┤ global hook: every real OR synthetic event ──►│ metrics
            │                                                │   │ per-minute score,
            │                                                │   │ synthetic vs real,
            │                                                │   │ shadow vs passive
 store     ─┤◄─ persists config + rolling metrics ───────────┘   ▼
            └────────────────────────────────────────────── IPC ▲
                                                                 │
 preload (contextBridge)  ◄──────────── renderer (UI views) ─────┘
```

**Synthetic vs real tagging:** the generator, immediately before it injects an event,
marks a short-lived "expected event" fingerprint (type + position + timestamp window).
The monitor matches incoming hook events against pending fingerprints: a match → **synthetic**,
otherwise → **real**. This is how Driftly measures both its own output and the human's input,
and how it tells them apart for the comparison view.

**Shadow vs passive:** every minute bucket records whether the generator was *enabled*
during that minute. Buckets are split into two series so the user can compare "activity while
Driftly runs" vs "activity from the human alone".

### Activity level model

| Level      | Move events/min | Clicks/min | Scrolls/min | Path style          |
|------------|-----------------|-----------:|------------:|---------------------|
| Gentle     | ~6              | ~0.5       | ~1          | small eased nudges  |
| Balanced   | ~18             | ~2         | ~3          | medium eased paths  |
| Energetic  | ~40             | ~5         | ~6          | larger eased paths  |
| Custom     | user-defined intensity 1–100 mapped onto the above ranges                |

All movement is **humanized**: eased (ease-in-out) cursor paths, micro-jitter, randomized
intervals, and screen-bounds clamping. Optional **"pause on real activity"**: if the human
moves the mouse/types, the generator backs off for a cooldown so it never fights the user.
Keystrokes default to *safe no-op keys* (e.g. Shift) and are **off by default**.

### Scheduler model
- Weekday toggles (Mon–Sun).
- One or more **time ranges** per active day (e.g. 09:00–13:00, 14:00–18:00).
- Optional global **work-session duration cap** and random start jitter.
- The scheduler only ever *enables/disables* the generator; the monitor always runs, so
  passive measurement continues 24/7 for the comparison.

### Persistence (local-only)
- `config.json` — all settings.
- `metrics.json` — rolling ring buffer of per-minute buckets (default 14 days), plus daily rollups.
- Export: **CSV** and **JSON** from the Compare view, for benchmarking against an external tool.

### Backends & graceful degradation
- `nut-js` (optional dependency) drives real input; `uiohook-napi` (optional) provides the
  global monitor. If either native module is unavailable on a platform/build, Driftly runs in
  **simulation mode**: the UI, scheduler, scoring, charts and exports all work using
  self-reported synthetic events, so the app is always runnable and demonstrable.

---

## 4. Architecture (website)

```
docs/                          (GitHub Pages publish folder)
├─ index.html                 Landing + download (RU primary, EN toggle), SEO-complete
├─ app/                        No-install web app (PWA) — runs in the browser
├─ assets/css/site.css        Brand theme (shares tokens with the app)
├─ assets/js/site.js          Nav, language toggle, animated live demo, reveal-on-scroll
├─ assets/img/                Logo, OG image, screenshots (SVG where possible)
├─ robots.txt
├─ sitemap.xml
└─ site.webmanifest
```

Sections: Hero (with an **animated, self-running demo** of a cursor drifting + a live
activity gauge) → Trust/feature highlights → How it works (3 steps) → Activity levels →
Measure & Compare → Privacy (local-only) → Download (per-OS) → FAQ → Footer.

**SEO:** semantic HTML, unique `<title>`/meta description, canonical, Open Graph + Twitter
cards, JSON-LD (`SoftwareApplication` + `FAQPage`), `robots.txt`, `sitemap.xml`, fast
self-contained assets, keyword-rich RU+EN copy, accessible contrast & alt text.

---

## 5. Brand & design tokens (shared by app and site)

- **Name:** Driftly · **Concept:** shadow user / synthetic presence + measurement
- **Fonts:** Space Grotesk (display), Inter (body) — Google Fonts
- **Palette (dark):**
  - `--bg #08080c` · `--s1 #0f0f16` · `--s2 #15151f` · `--s3 #1c1c2b`
  - `--brand #7c5cff` (violet) · `--brand2 #9d86ff` · `--accent #2dd4bf` (mint)
  - `--amber #f0a93a` (sparing) · `--text #f2f2f8` · `--muted rgba(242,242,248,.55)`
  - `--border rgba(255,255,255,.07)` · `--grad linear-gradient(135deg,#7c5cff,#2dd4bf)`
- **Radius:** 16px / 22px · **Logo:** cursor arrow with a soft drifting shadow + orbiting dot.

---

## 6. Legal / privacy posture
- **License:** proprietary — **all rights reserved to the owner**. Free to download and use;
  no redistribution/modification rights granted (see `LICENSE`).
- **Privacy:** no data collection, no telemetry, no accounts. Everything is stored locally.
  (see `PRIVACY.md`).
- **Responsible use:** intended for automation, anti-idle, and testing/benchmarking on
  systems you own or are authorized to use; not for deceiving systems you are not
  authorized to operate. Stated prominently in app + site + README.

---

## 7. Build / release flow
1. `cd app && npm install` → `npm start` (dev) — runs even without native modules (sim mode).
2. `npm run dist` → electron-builder produces installers for Win/macOS/Linux.
3. Upload installers to **GitHub Releases**; the website's download buttons point there.

---

## 8. Status checklist
- [x] Plan & brand locked (this file)
- [x] Repo docs: README, LICENSE, PRIVACY
- [x] Desktop app (main, generator, monitor, metrics, scheduler, UI)
- [x] Website (landing + download, SEO, animated demo)
- [x] Validation (syntax checks, site preview)
- [x] Commit & push to `claude/sharp-fermi-t803lf`
