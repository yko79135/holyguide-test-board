import { authenticate, sql, loadBoard, send, fail, body, seoulToday, PERIODS } from './_lib.js';
import { createCalendarEvent, deleteCalendarEvent } from './_integrations.js';
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

    if (!['approve', 'decline', 'reopen', 'reschedule'].includes(decision)) {
      return send(res, 400, { error: 'Unknown decision.' });
    }

    const rows = await sql`select id, status, calendar_event_id from proposals where id = ${id} limit 1`;
    if (!rows.length) return send(res, 404, { error: 'That proposal is no longer on the board.' });
    const existingEventId = rows[0].calendar_event_id;

    if (decision === 'reschedule') {
      /* Moving an approved test is not a reopen. Reopen makes the row
         pending, which throws away the approval and asks Mr. Ko to decide
         something he already decided. The test stays approved; only the
         date, the slot and the calendar event move. */
      if (rows[0].status !== 'approved') {
        return send(res, 400, { error: 'Only an approved test can be rescheduled.' });
      }
      const date = String(b.date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Pick the new test date.' });
      if (date < seoulToday()) return send(res, 400, { error: 'The new date is already in the past.' });

      // Same rule as propose: a period wins and fixes the time.
      const period = b.period == null || b.period === '' ? null : Number(b.period);
      let time = String(b.time || '').trim();
      if (period !== null) {
        const match = PERIODS.find((x) => x.n === period);
        if (!match) return send(res, 400, { error: 'That is not one of the school periods.' });
        time = match.start;
      } else if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        return send(res, 400, { error: 'That time does not look right — use HH:MM.' });
      }

      /* Materials already sent stay sent — the student has them, and a
         new date is no reason to mail them twice. Anything not yet sent
         goes back to 'scheduled' so the morning run judges it against the
         new date, and last_check clears so a "still missing" note to
         Mr. Ko is not suppressed for the day. */
      await sql`
        update proposals
           set test_date = ${date}::date, test_period = ${period}, test_time = ${time || null},
               delivery_status = case when delivery_status = 'sent' then 'sent' else 'scheduled' end,
               last_check = case when delivery_status = 'sent' then last_check else null end,
               teacher_note = case when ${teacherNote} = '' then teacher_note else ${teacherNote} end
         where id = ${id}`;

      // An open build request carries the date the desktop works toward.
      await sql`
        update build_requests set test_date = ${date}::date
         where proposal_id = ${id} and status in ('pending', 'claimed')`;

      const fresh = await sql`
        select p.id, p.subject, p.course, p.chapter, p.note, p.teacher_note,
               to_char(p.test_date,'YYYY-MM-DD') as test_date,
               p.test_period, to_char(p.test_time,'HH24:MI') as test_time,
               s.name as student_name
          from proposals p join students s on s.id = p.student_id
         where p.id = ${id} limit 1`;
      await deleteCalendarEvent(existingEventId);
      const eventId = await createCalendarEvent(fresh[0], fresh[0].student_name);
      await sql`update proposals set calendar_event_id = ${eventId} where id = ${id}`;
    } else if (decision === 'approve') {
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
