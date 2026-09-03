import { authenticate, sql, loadBoard, send, fail, body, seoulToday } from './_lib.js';
import { deleteCalendarEvent } from './_integrations.js';
import { approveProposal } from './_approve.js';

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

    const rows = await sql`select id, calendar_event_id from proposals where id = ${id} limit 1`;
    if (!rows.length) return send(res, 404, { error: 'That proposal is no longer on the board.' });
    const existingEventId = rows[0].calendar_event_id;

    if (decision === 'approve') {
      /* Shared with auto-approval in _approve.js, so the button and the
         board's own decision can never drift apart. */
      await approveProposal(id, existingEventId, teacherNote);
    } else if (decision === 'decline') {
      await deleteCalendarEvent(existingEventId);
      await sql`
        update proposals
           set status='declined', decided_at=now(), calendar_event_id=null,
               teacher_note = case when ${teacherNote} = '' then teacher_note else ${teacherNote} end
         where id = ${id}`;
    } else {
      await deleteCalendarEvent(existingEventId);
      await sql`
        update proposals
           set status='pending', decided_at=null, delivery_status='scheduled',
               sent_at=null, files='[]'::jsonb, last_check=null, calendar_event_id=null
         where id = ${id}`;
    }

    const board = await loadBoard();
    send(res, 200, { me, today: seoulToday(), ...board });
  } catch (err) {
    fail(res, err);
  }
}
