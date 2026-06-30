'use strict';
/* server/mailer.js — pluggable email sender for passwordless sign-in codes.
 *
 * Dev default ("console") logs the code and returns it in the API response so the
 * flow is testable without a real mailbox. The live deployment is the PHP server,
 * which sends via host SMTP (php-mail) — see server-php/lib/mailer.php. For a Node/VPS
 * deployment, wire your SMTP/ESP of choice here as an extra REGISTRY entry. */

const consoleMailer = {
  name: 'console',
  ready() { return true; },
  async send(email, code) {
    console.log(`[mailer:console] sign-in code for ${email}: ${code}`);
    return { devCode: code }; // surfaced to the client ONLY in dev
  },
};

const REGISTRY = { console: consoleMailer };

function select() {
  const want = (process.env.DRIFTLY_MAILER || 'console').toLowerCase();
  const m = REGISTRY[want];
  if (m && m.ready()) return m;
  return consoleMailer;
}

module.exports = { select };
