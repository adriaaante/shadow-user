'use strict';
/* server/mailer.js — pluggable email sender for passwordless sign-in codes.
 *
 * Dev default ("console") logs the code and returns it in the API response so the
 * flow is testable without a real mailbox. For production select a provider via
 * env: DRIFTLY_MAILER=unisender-go (uses Node's global fetch — no deps).
 * The sending domain (driftly.site) must be verified (SPF/DKIM/DMARC) or codes
 * land in spam. Sign-in codes are time-sensitive — a code in spam breaks login.
 * (The live PHP deployment uses host SMTP via php-mail; see server-php/lib/mailer.php.) */

// Shared bilingual (RU/EN) code email body.
function codeEmail(code) {
  return {
    subject: `Driftly — код входа / sign-in code: ${code}`,
    text: `Ваш код для входа в Driftly: ${code}\nДействителен 10 минут. Если вы не запрашивали код — просто проигнорируйте письмо.\n\n`
      + `Your Driftly sign-in code: ${code}\nValid for 10 minutes. If you didn't request it, ignore this email.`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">`
      + `<h2 style="margin:0 0 4px">Driftly</h2>`
      + `<p style="margin:0 0 16px;color:#666">Код для входа в аккаунт · Your sign-in code</p>`
      + `<div style="font-size:32px;font-weight:700;letter-spacing:6px;background:#f4f3ff;border:1px solid #e3e0ff;border-radius:10px;padding:18px;text-align:center;color:#5b3cf0">${code}</div>`
      + `<p style="margin:16px 0 0;color:#888;font-size:13px">Действителен 10 минут. Если вы не запрашивали код — проигнорируйте это письмо.<br>`
      + `Valid for 10 minutes. If you didn't request this, ignore this email.</p></div>`,
  };
}

const consoleMailer = {
  name: 'console',
  ready() { return true; },
  async send(email, code) {
    console.log(`[mailer:console] sign-in code for ${email}: ${code}`);
    return { devCode: code }; // surfaced to the client ONLY in dev
  },
};

// Unisender Go (https://go.unisender.ru) — RU transactional service, good inbox
// rates for Yandex/Mail.ru. Enable with:
//   DRIFTLY_MAILER=unisender-go  UNISENDER_GO_API_KEY=xxx
//   [UNISENDER_GO_API_URL=https://go1.unisender.ru/ru/transactional/api/v1]
//   [MAIL_FROM_EMAIL=support@driftly.site]  [MAIL_FROM_NAME=Driftly]
const unisenderGoMailer = {
  name: 'unisender-go',
  ready() { return !!process.env.UNISENDER_GO_API_KEY; },
  async send(email, code) {
    const base = (process.env.UNISENDER_GO_API_URL || 'https://go1.unisender.ru/ru/transactional/api/v1').replace(/\/$/, '');
    const e = codeEmail(code);
    const res = await fetch(base + '/email/send.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.UNISENDER_GO_API_KEY,
        message: {
          recipients: [{ email }],
          body: { html: e.html, plaintext: e.text },
          subject: e.subject,
          from_email: process.env.MAIL_FROM_EMAIL || 'support@driftly.site',
          from_name: process.env.MAIL_FROM_NAME || 'Driftly',
          track_links: 0, track_read: 0,
        },
      }),
    });
    const j = await res.json().catch(() => ({}));
    const failed = j && j.failed_emails && Object.keys(j.failed_emails).length;
    if (!res.ok || (j && j.status === 'error') || failed) {
      throw new Error('unisender_go_failed: ' + JSON.stringify(j).slice(0, 200));
    }
    return {}; // real email sent — no devCode exposed
  },
};

const REGISTRY = { console: consoleMailer, 'unisender-go': unisenderGoMailer };

function select() {
  const want = (process.env.DRIFTLY_MAILER || 'console').toLowerCase();
  const m = REGISTRY[want];
  if (m && m.ready()) return m;
  return consoleMailer;
}

module.exports = { select };
