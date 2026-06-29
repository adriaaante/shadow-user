'use strict';
/* server/mailer.js — pluggable email sender for passwordless sign-in codes.
 *
 * Dev default ("console") logs the code and returns it in the API response so the
 * flow is testable without a real mailbox. For production, wire an SMTP/Resend/
 * Postmark provider where the TODO is and select it via env (DRIFTLY_MAILER). */

const consoleMailer = {
  name: 'console',
  ready() { return true; },
  async send(email, code) {
    console.log(`[mailer:console] sign-in code for ${email}: ${code}`);
    return { devCode: code }; // surfaced to the client ONLY in dev
  },
};

// Resend (https://resend.com) — transactional email over a plain HTTPS API, so
// no SMTP and no npm dependency (uses Node's global fetch). Enable with:
//   DRIFTLY_MAILER=resend  RESEND_API_KEY=re_xxx  [MAIL_FROM="Driftly <support@driftly.site>"]
// The sending domain (driftly.site) must be verified in Resend (SPF/DKIM/DMARC),
// or codes will land in spam.
const resendMailer = {
  name: 'resend',
  ready() { return !!process.env.RESEND_API_KEY; },
  async send(email, code) {
    const from = process.env.MAIL_FROM || 'Driftly <support@driftly.site>';
    const replyTo = process.env.MAIL_REPLY_TO || 'support@driftly.site';
    const subject = `Driftly — код входа / sign-in code: ${code}`;
    const text = `Ваш код для входа в Driftly: ${code}\nДействителен 10 минут. Если вы не запрашивали код — просто проигнорируйте письмо.\n\n`
      + `Your Driftly sign-in code: ${code}\nValid for 10 minutes. If you didn't request it, ignore this email.`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">`
      + `<h2 style="margin:0 0 4px">Driftly</h2>`
      + `<p style="margin:0 0 16px;color:#666">Код для входа в аккаунт · Your sign-in code</p>`
      + `<div style="font-size:32px;font-weight:700;letter-spacing:6px;background:#f4f3ff;border:1px solid #e3e0ff;border-radius:10px;padding:18px;text-align:center;color:#5b3cf0">${code}</div>`
      + `<p style="margin:16px 0 0;color:#888;font-size:13px">Действителен 10 минут. Если вы не запрашивали код — проигнорируйте это письмо.<br>`
      + `Valid for 10 minutes. If you didn't request this, ignore this email.</p></div>`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], reply_to: replyTo, subject, text, html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`resend_failed_${res.status}: ${detail.slice(0, 200)}`);
    }
    return {}; // real email sent — no devCode exposed to the client
  },
};

const REGISTRY = { console: consoleMailer, resend: resendMailer };

function select() {
  const want = (process.env.DRIFTLY_MAILER || 'console').toLowerCase();
  const m = REGISTRY[want];
  if (m && m.ready()) return m;
  return consoleMailer;
}

module.exports = { select };
