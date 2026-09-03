import { sql, send, CONFIG } from './_lib.js';

/* An unauthenticated liveness probe.
 *
 * Every other route answers 401 before it ever touches Postgres, so a
 * wrong DATABASE_URL looks exactly like a healthy board until someone
 * signs in — and then it is a 500 the client swallows. This says which
 * it is, and reveals nothing about the data: a row count and, when the
 * connection fails, Postgres's own SQLSTATE (28P01 = bad password,
 * 3D000 = no such database, ENOTFOUND = no such host). */
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
    out.code = err.code || err.name || 'Error';
  }
  send(res, 200, out);
}
