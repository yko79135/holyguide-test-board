import { authenticate, sql, loadBoard, send, fail, body, seoulToday, PERIODS, CONFIG } from './_lib.js';
import { emailTeacher, whenLabel } from './_integrations.js';

export default async function handler(req, res) {
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

    if (!chapter) return send(res, 400, { error: 'Say which chapter the test is on.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Pick a test date.' });
    if (date <= seoulToday()) return send(res, 400, { error: 'Pick a date in the future.' });

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

    const dupe = await sql`
      select id from proposals
      where student_id = ${me.studentId} and subject = ${subject}
        and lower(chapter) = lower(${chapter}) and status in ('pending','approved')
      limit 1`;
    if (dupe.length) {
      return send(res, 409, { error: 'You already have a ' + subject + ' ' + chapter + ' date on the board.' });
    }

    const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await sql`
      insert into proposals (id, student_id, subject, course, chapter, test_date, test_period, test_time, note)
      values (${id}, ${me.studentId}, ${subject}, ${course}, ${chapter}, ${date},
              ${period}, ${time || null}, ${note})`;

    await emailTeacher(
      me.studentName + ' proposed a ' + subject + ' test — ' + chapter,
      [
        me.studentName + ' has asked for a test date and it is waiting for your approval.',
        '',
        'Subject:  ' + subject + (course ? ' (' + course + ')' : ''),
        'Chapter:  ' + chapter,
        'When:     ' + whenLabel({ test_date: date, test_period: period, test_time: time }),
        note ? 'Their note: ' + note : '',
        '',
        'Approve or decline: ' + CONFIG.appUrl,
      ]
    );

    const board = await loadBoard();
    send(res, 200, { me, today: seoulToday(), ...board });
  } catch (err) {
    fail(res, err);
  }
}
