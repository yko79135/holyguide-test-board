import { CUTOFF_UTC } from './_worker-snapshot-core.mjs';
import { randomUUID } from 'node:crypto';
import { sql, CONFIG } from './_lib.js';
import { createCalendarEvent, deleteCalendarEvent, whenLabel } from './_integrations.js';
import { materialKind, findMaterial } from './_materials.js';

/* ------------------------------------------------------------------ *
 * Approval, in one place.
 *
 * A proposal Mr. Ko would have approved anyway should not have to wait
 * for him to open the board. The rules below are the ones he stated;
 * anything a rule cannot vouch for stays pending and reaches him by
 * email exactly as it did before. There is deliberately no one-click
 * approve/undo link in that email: such a link is an unauthenticated
 * mutation endpoint, and the board's whole auth model is the Google
 * token. Undoing is a reopen on the board, which is one tap on a phone.
 * ------------------------------------------------------------------ */

/* A kill switch that does not need a deploy: insert into settings
   (key,value) values ('auto_approve','off'). Absent means on. */
export async function autoApproveEnabled() {
  const rows = await sql`select value from settings where key = 'auto_approve' limit 1`;
  if (!rows.length) return true;
  return String(rows[0].value).trim().toLowerCase() !== 'off';
}

export async function leadDays() {
  const rows = await sql`select value from settings where key = 'lead_days' limit 1`;
  const n = Number(rows.length ? rows[0].value : 7);
  return Number.isFinite(n) && n >= 0 ? n : 7;
}

/* Whole days between two Seoul calendar dates. Both are 'YYYY-MM-DD'
   strings already resolved in Asia/Seoul, so this is pure arithmetic
   on the calendar and never touches a timezone again. */
function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function isWeekend(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 || wd === 6;
}

/* Returns the reasons this proposal must NOT be auto-approved.
   Empty array => approve it. */
export async function holdReasons(p, today, lead) {
  const reasons = [];

  const notice = dayNumber(p.test_date) - dayNumber(today);
  if (notice < lead) {
    reasons.push(
      'only ' + notice + ' day' + (notice === 1 ? '' : 's') +
      ' notice — the board asks for ' + lead
    );
  }

  if (isWeekend(p.test_date)) reasons.push('the date falls on a weekend');

  const clash = await sql`
    select id from proposals
     where student_id = ${p.student_id}
       and test_date = ${p.test_date}
       and status = 'approved'
       and id <> ${p.id}
     limit 1`;
  if (clash.length) reasons.push('this student already has an approved test that day');

  return reasons;
}

/* The approve path, shared by the teacher's button and auto-approval.
   Reads the row back from Postgres rather than trusting a caller: the
   date and time are the student's, and this is what actually landed. */
export async function approveProposal(id, existingEventId, teacherNote = '') {
  await sql`
    update proposals
       set status='approved', decided_at=now(), delivery_status='scheduled',
           teacher_note = case when ${teacherNote} = '' then teacher_note else ${teacherNote} end
     where id = ${id}`;

  const fresh = await sql`
    select p.id, p.student_id, p.subject, p.course, p.chapter, p.note, p.teacher_note, p.created_at,
           to_char(p.test_date,'YYYY-MM-DD') as test_date,
           p.test_period, to_char(p.test_time,'HH24:MI') as test_time,
           s.name as student_name, s.math_course, s.science_course
      from proposals p join students s on s.id = p.student_id
     where p.id = ${id} limit 1`;

  /* Re-approving after a reopen would otherwise leave the old event
     orphaned on the calendar. */
  if (existingEventId) await deleteCalendarEvent(existingEventId);

  const eventId = await createCalendarEvent(fresh[0], fresh[0].student_name);
  await sql`update proposals set calendar_event_id = ${eventId} where id = ${id}`;

  const buildRequestId = await queueBuildIfMissing(fresh[0]);

  return { row: fresh[0], eventId, buildRequestId };
}

/* Ask the desktop to build the document, but only if Drive hasn't got it.
 *
 * Approval is the moment he learns a chapter is coming, so it is the
 * moment to find out nothing exists for it — not the morning it was due,
 * which is when the old flow noticed. If a student proposes a test three
 * weeks out, this puts the gap on someone's desk with three weeks left.
 *
 * Best-effort by construction, exactly like the calendar above: an
 * approval must never fail because Drive was slow or a folder id was
 * wrong. Worst case nothing is queued and the morning run behaves as it
 * always has. */
async function queueBuildIfMissing(row) {
  if (new Date(row.created_at) >= new Date(CUTOFF_UTC)) return null;
  try {
    const kind = materialKind(row.subject);
    const course =
      row.course || (row.subject === 'Math' ? row.math_course : row.science_course) || '';
    if (await findMaterial({ chapter: row.chapter, kind, course })) return null;

    const requestId = 'br_' + randomUUID();
    /* One open request per proposal, enforced by a partial unique index
       rather than by checking first — re-approving after a reopen must
       not queue the same chapter twice. */
    const rows = await sql`
      insert into build_requests
        (id, proposal_id, student_id, subject, course, chapter, kind, test_date)
      values
        (${requestId}, ${row.id}, ${row.student_id}, ${row.subject}, ${course},
         ${row.chapter}, ${kind}, ${row.test_date}::date)
      on conflict do nothing
      returning id`;
    return rows.length ? requestId : null;
  } catch (err) {
    console.error('[approve] could not queue a build for ' + row.id + ':', err.message);
    return null;
  }
}

/* The email Mr. Ko gets when the board decided for him. */
export function autoApprovedEmail(row, eventId) {
  return {
    subject: row.student_name + '’s ' + row.subject + ' ' + row.chapter +
             ' test was approved automatically',
    lines: [
      'The board approved this one for you — it met every rule.',
      '',
      'Student: ' + row.student_name,
      'Subject: ' + row.subject + (row.course ? ' (' + row.course + ')' : ''),
      'Chapter: ' + row.chapter,
      'When: ' + whenLabel(row),
      row.note ? 'Their note: ' + row.note : '',
      '',
      eventId
        ? 'It is on your calendar.'
        : 'It is NOT on your calendar — Google refused the event. Approving again on the board retries.',
      '',
      'If you disagree, reopen or decline it here: ' + CONFIG.appUrl,
    ],
  };
}
