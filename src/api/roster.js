import { authenticate, sql, loadBoard, send, fail, body, seoulToday } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  try {
    const me = await authenticate(req);
    if (me.role !== 'teacher') return send(res, 403, { error: 'Only Mr. Ko can edit the roster.' });

    const b = body(req);
    const id = String(b.id || '');
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
    const math = String(b.math || '').trim().slice(0, 120);
    const science = String(b.science || '').trim().slice(0, 120);

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return send(res, 400, { error: 'That does not look like an email address.' });
    }

    const rows = await sql`select email from students where id = ${id} limit 1`;
    if (!rows.length) return send(res, 404, { error: 'No such student.' });

    const clash = email
      ? await sql`select id from students where lower(email) = ${email} and id <> ${id} limit 1`
      : [];
    if (clash.length) return send(res, 409, { error: 'Another student already uses that address.' });

    const changed = String(rows[0].email || '').toLowerCase() !== email;
    await sql`
      update students
      set email = ${email},
          email_confirmed = case when ${changed} then false else email_confirmed end,
          math_course = ${math},
          science_course = ${science}
      where id = ${id}`;

    const board = await loadBoard();
    send(res, 200, { me, today: seoulToday(), ...board });
  } catch (err) {
    fail(res, err);
  }
}
