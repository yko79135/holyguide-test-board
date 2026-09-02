import { authenticate, sql, loadBoard, send, fail, body, seoulToday } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  try {
    const me = await authenticate(req);
    const id = String(body(req).id || '');

    const rows = await sql`select student_id, status from proposals where id = ${id} limit 1`;
    if (!rows.length) return send(res, 404, { error: 'That proposal is no longer on the board.' });

    const owned = me.role === 'student' && rows[0].student_id === me.studentId;
    if (!owned && me.role !== 'teacher') {
      return send(res, 403, { error: 'You can only withdraw your own proposals.' });
    }
    if (rows[0].status !== 'pending') {
      return send(res, 409, { error: 'Only a proposal still waiting for Mr. Ko can be withdrawn.' });
    }

    await sql`delete from proposals where id = ${id}`;
    const board = await loadBoard();
    send(res, 200, { me, today: seoulToday(), ...board });
  } catch (err) {
    fail(res, err);
  }
}
