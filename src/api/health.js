import crypto from 'node:crypto';
import { sql, send, CONFIG } from './_lib.js';

/* An unauthenticated liveness probe.
 *
 * Every other route answers 401 before it ever touches Postgres, so a
 * wrong DATABASE_URL looks exactly like a healthy board until someone
 * signs in — and then it is a 500 the client swallows. The calendar is
 * worse: a bad private key fails inside a best-effort path that is
 * designed never to throw, so the only symptom is an event that never
 * appears. This says which parts are actually working, and reveals
 * nothing: a row count, a boolean per credential, and error codes
 * (28P01 = bad password, ERR_OSSL_UNSUPPORTED = mangled PEM). */
export default async function handler(req, res) {
  const out = {
    databaseUrlSet: Boolean(CONFIG.databaseUrl),
    calendar: Boolean(CONFIG.saEmail && CONFIG.saKey && CONFIG.calendarId),
    email: Boolean(CONFIG.resendKey),
  };

  try {
    const rows = await sql`select 1 as ok`;
    out.db = rows.length === 1;
  } catch (err) {
    out.db = false;
    out.dbCode = err.code || err.name || 'Error';
  }

  if (CONFIG.saKey) {
    try {
      crypto.createPrivateKey(CONFIG.saKey);
      out.saKeyParses = true;
    } catch (err) {
      out.saKeyParses = false;
      out.saKeyCode = err.code || err.name || 'Error';
      /* Shape only, never key material: the BEGIN/END markers are public
         constants, and a length plus a newline count is what separates a
         truncated paste from a whole JSON object pasted by mistake. */
      out.saKeyShape = {
        length: CONFIG.saKey.length,
        head: CONFIG.saKey.slice(0, 28),
        tail: CONFIG.saKey.trim().slice(-26),
        newlines: (CONFIG.saKey.match(/\n/g) || []).length,
      };
    }
  }

  send(res, 200, out);
}
