import { authenticate, sql, loadBoard, send, fail, body, seoulToday } from './_lib.js';
import { createCalendarEvent, deleteCalendarEvent } from './_integrations.js';

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
      await sql`
        update proposals
        set status='approved', decided_at=now(), delivery_status='scheduled',
            teacher_note = case when ${teacherNote} = '' then teacher_note else ${teacherNote} end
        where id = ${id}`;

      /* Read the row back rather than trusting the request body: the
         date and time are the student's, and this is what actually
         landed in Postgres. */
      const fresh = await sql`
        select p.id, p.subject, p.course, p.chapter, p.note, p.teacher_note,
               to_char(p.test_date,'YYYY-MM-DD') as test_date,
               p.test_period, to_char(p.test_time,'HH24:MI') as test_time,
               s.name as student_name
        from proposals p join students s on s.id = p.student_id
        where p.id = ${id} limit 1`;

      /* Re-approving after a reopen would otherwise leave the old event
         orphaned on the calendar. */
      if (existingEventId) await deleteCalendarEvent(existingEventId);

      const eventId = await createCalendarEvent(fresh[0], fresh[0].student_name);
      await sql`update proposals set calendar_event_id = ${eventId} where id = ${id}`;
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
