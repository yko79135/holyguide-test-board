import { authenticate, sql, loadBoard, send, fail, body, seoulToday } from './_lib.js';

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
      insert into proposals (id, student_id, subject, course, chapter, test_date, note)
      values (${id}, ${me.studentId}, ${subject}, ${course}, ${chapter}, ${date}, ${note})`;

    const board = await loadBoard();
    send(res, 200, { me, today: seoulToday(), ...board });
  } catch (err) {
    fail(res, err);
  }
}
