# Privacy Statement — Driftly

**Short version: your activity data never leaves your computer. The only data we process is
the minimum needed to run your subscription (your email + billing state) — and card details
are handled by the payment provider, never by us.**

## Activity data — always local
Driftly's core (settings, activity metrics, charts) has **no analytics and no telemetry**.
Your activity data — what you type, click, or measure — is **never uploaded**. It stays on
your device (see "What stays on your device" below). This is true on both the web and
desktop versions.

## Subscription data — only if you subscribe
Driftly is a paid product with a free trial. To run a subscription that works across the web
and desktop apps, the licensing server processes the minimum necessary:
- **Your email** — to identify your account and unlock both apps with one subscription.
- **Billing state** — your plan status (trialing / active / past_due / canceled) and renewal
  dates, so access can be granted or paused.

**Card data is NOT handled by Driftly.** All payments are processed by the payment provider
(**T‑Bank** or **YooKassa**), who securely store and charge your card. Driftly never sees or
stores your card number. If you never start a trial/subscription, no account is created.

You can cancel anytime and request deletion of your account data via the contact below.

## What stays on your device
All settings and activity metrics are stored **locally** on your own computer:
- `config.json` — your settings (activity level, schedule, preferences);
- `metrics.json` — a rolling local history of per-minute activity scores (default ~14 days).

These files live in your operating system's standard per-user application data folder and
are never uploaded. You can delete them at any time; you can also export your metrics to
CSV/JSON yourself for your own benchmarking.

## Activity measurement
Driftly counts input events (mouse movement, clicks, scroll, keystrokes) **only to compute
activity scores on your machine**. It records counts and timing — not the content of what
you type. Keystroke logging of *content* is never performed.

## Third parties
None. Driftly does not embed third-party trackers or send data to any third party.

## Website
The Driftly website is a static site. It does not set tracking cookies. If hosted on a
third-party platform (e.g. GitHub Pages), that host may keep standard server access logs
outside of our control.

## Contact
For any request — privacy, billing, cancellation, account deletion, or general
support — write to **support@driftly.site**. We aim to respond within a few business
days. (For data-protection matters you may also use privacy@driftly.site if configured.)

_Last updated: 2026-06-25._
