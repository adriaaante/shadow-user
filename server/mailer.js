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

// Example real provider skeleton — fill in and add to REGISTRY to enable.
// const smtpMailer = {
//   name: 'smtp', ready: () => !!process.env.SMTP_URL,
//   async send(email, code) { /* TODO: send via nodemailer/Resend/Postmark */ return {}; },
// };

const REGISTRY = { console: consoleMailer };

function select() {
  const want = (process.env.DRIFTLY_MAILER || 'console').toLowerCase();
  const m = REGISTRY[want];
  if (m && m.ready()) return m;
  return consoleMailer;
}

module.exports = { select };
