import { authenticate, sql, loadBoard, send, fail, body, seoulToday } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  try {
    const me = await authenticate(req);
    if (me.role !== 'teacher') return send(res, 403, { error: 'Only Mr. Ko can approve test dates.' });

    const b = body(req);
    const id = String(b.id || '');
    const decision = String(b.decision || '');
    const teacherNote = String(b.teacherNote || '').trim().slice(0, 400);

    if (!['approve', 'decline', 'reopen'].includes(decision)) {
      return send(res, 400, { error: 'Unknown decision.' });
    }

    const rows = await sql`select id from proposals where id = ${id} limit 1`;
    if (!rows.length) return send(res, 404, { error: 'That proposal is no longer on the board.' });

    if (decision === 'approve') {
      await sql`
        update proposals
        set status='approved', decided_at=now(), delivery_status='scheduled',
            teacher_note = case when ${teacherNote} = '' then teacher_note else ${teacherNote} end
        where id = ${id}`;
    } else if (decision === 'decline') {
      await sql`
        update proposals
        set status='declined', decided_at=now(),
            teacher_note = case when ${teacherNote} = '' then teacher_note else ${teacherNote} end
        where id = ${id}`;
    } else {
      await sql`
        update proposals
        set status='pending', decided_at=null, delivery_status='scheduled',
            sent_at=null, files='[]'::jsonb, last_check=null
        where id = ${id}`;
    }

    const board = await loadBoard();
    send(res, 200, { me, today: seoulToday(), ...board });
  } catch (err) {
    fail(res, err);
  }
}
