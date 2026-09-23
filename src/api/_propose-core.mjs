/* The body of /api/propose, with its collaborators injected.
 *
 * Split out for the reason the worker routes were: an ES module namespace is
 * read-only, so a test cannot replace `sql` or `authenticate` on the imported
 * module. Taking them as arguments makes the rules — especially the Geometry
 * format rule, which decides whether a row is written at all — testable
 * without a database, a Google token, or a mail provider.
 *
 * propose.js is the thin wiring; everything that can be got wrong lives here.
 */

import { isGeometry, geometryModeLabel, GEOMETRY_MODES } from './_materials.js';

export function createHandler({
  authenticate, sql, loadBoard, send, fail, body, seoulToday, PERIODS, CONFIG,
  emailTeacher, whenLabel,
  autoApproveEnabled, leadDays, holdReasons, approveProposal, autoApprovedEmail,
  newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
    try {
      const me = await authenticate(req);
      if (me.role !== 'student') {
        return send(res, 403, { error: 'Only students propose test dates.' });
      }
      const b = body(req);
      const subject = b.subject === 'Science' ? 'Science' : 'Math';
      const chapter = String(b.chapter || '').trim().slice(0, 40);
      const course = String(b.course || '').trim().slice(0, 120);
      const note = String(b.note || '').trim().slice(0, 400);
      const date = String(b.date || '').trim();
      const today = seoulToday();

      /* Geometry needs its format before anything can be built for it: the
         desktop queue refuses a Geometry reservation that does not say
         whether it is the BJU chapter test or six demonstrated proofs.
         Asked here, of the student, because it is their test. Every other
         course ignores this field, and an unrecognised value is refused
         rather than quietly stored. */
      const geometry = isGeometry(subject, course);
      const geometryMode = geometry
        ? (GEOMETRY_MODES.includes(b.geometryMode) ? b.geometryMode : null)
        : null;
      if (geometry && !geometryMode) {
        return send(res, 400, {
          error: 'Choose how this Geometry test is taken — the BJU chapter test, or six demonstrated chapter proofs.',
        });
      }

      if (!chapter) return send(res, 400, { error: 'Say which chapter the test is on.' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Pick a test date.' });
      if (date <= today) return send(res, 400, { error: 'Pick a date in the future.' });

      // Either a school period, or a free time, or neither. A period wins
      // and fixes the time, so the two can never disagree on the row.
      let period = b.period == null || b.period === '' ? null : Number(b.period);
      let time = String(b.time || '').trim();
      if (period !== null) {
        const match = PERIODS.find((x) => x.n === period);
        if (!match) return send(res, 400, { error: 'That is not one of the school periods.' });
        time = match.start;
      } else if (time) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
          return send(res, 400, { error: 'That time does not look right — use HH:MM.' });
        }
      } else {
        time = '';
      }

      /* One live date per chapter — but only a date that has not happened
         yet. A test that was missed (illness, a closure, a clash) leaves an
         approved row sitting in the past, and the old check read that row as
         "you already have a date" and refused the student a second one
         forever. The row is kept, because it is the record that the date was
         once booked; it simply stops blocking. Anything still on or after
         today does block, so this is not a way to hold two dates at once. */
      const dupe = await sql`
        select to_char(test_date,'YYYY-MM-DD') as test_date from proposals
         where student_id = ${me.studentId} and subject = ${subject}
           and lower(chapter) = lower(${chapter}) and status in ('pending','approved')
           and test_date >= ${today}::date
         limit 1`;
      if (dupe.length) {
        return send(res, 409, {
          error: 'You already have a ' + subject + ' ' + chapter + ' date on the board — ' +
                 dupe[0].test_date + '. Withdraw it first if you want a different day.',
        });
      }

      const id = newId();
      await sql`
        insert into proposals (id, student_id, subject, course, chapter, test_date,
                               test_period, test_time, note, geometry_mode)
        values (${id}, ${me.studentId}, ${subject}, ${course}, ${chapter}, ${date},
                ${period}, ${time || null}, ${note}, ${geometryMode})`;

      /* Auto-approval. The row is already in Postgres and is the source of
         truth; everything below is best-effort on top of it, so a failure
         here must not lose the student's proposal. */
      let approved = false;
      try {
        if (await autoApproveEnabled()) {
          const lead = await leadDays();
          const reasons = await holdReasons(
            { id, student_id: me.studentId, test_date: date }, today, lead
          );
          if (!reasons.length) {
            const { row, eventId } = await approveProposal(id, null);
            approved = true;
            const mail = autoApprovedEmail(row, eventId);
            await emailTeacher(mail.subject, mail.lines);
          } else {
            await emailTeacher(
              me.studentName + ' proposed a ' + subject + ' test — ' + chapter,
              [
                me.studentName + ' has asked for a test date and it is waiting for your approval.',
                'The board did not approve it automatically because ' + reasons.join('; ') + '.',
                '',
                'Subject: ' + subject + (course ? ' (' + course + ')' : ''),
                'Chapter: ' + chapter,
                geometryMode ? 'Format: ' + geometryModeLabel(geometryMode) : '',
                'When: ' + whenLabel({ test_date: date, test_period: period, test_time: time }),
                note ? 'Their note: ' + note : '',
                '',
                'Approve or decline: ' + CONFIG.appUrl,
              ]
            );
          }
        } else {
          await emailTeacher(
            me.studentName + ' proposed a ' + subject + ' test — ' + chapter,
            [
              me.studentName + ' has asked for a test date and it is waiting for your approval.',
              '',
              'Subject: ' + subject + (course ? ' (' + course + ')' : ''),
              'Chapter: ' + chapter,
              geometryMode ? 'Format: ' + geometryModeLabel(geometryMode) : '',
              'When: ' + whenLabel({ test_date: date, test_period: period, test_time: time }),
              note ? 'Their note: ' + note : '',
              '',
              'Approve or decline: ' + CONFIG.appUrl,
            ]
          );
        }
      } catch (err) {
        console.error('[auto-approve] ' + id + ':', err.message);
      }

      const board = await loadBoard();
      send(res, 200, { me, today, autoApproved: approved, ...board });
    } catch (err) {
      fail(res, err);
    }
  };
}
