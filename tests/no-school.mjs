/* No school that day — declined at once, and the student is told.
 *
 * Mr. Ko (2026-10-14): approve every test request, but decline one booked on
 * a day with no school and email the student. This proves the calendar rule
 * on real dates from the copied school calendar, and that the propose handler
 * writes a declined row, emails the student (Mr. Ko copied), and never
 * approves it — while a school day is still approved as before.
 */
import assert from 'node:assert/strict';
import { noSchoolReason } from '../src/api/_school-days.js';
import { createHandler } from '../src/api/_propose-core.mjs';

/* --- the calendar rule -------------------------------------------------- */

assert.equal(noSchoolReason('2026-10-15'), null, 'an ordinary Thursday in term has school');
assert.match(noSchoolReason('2026-10-17'), /Saturday/);
assert.match(noSchoolReason('2026-10-18'), /Sunday/);
assert.match(noSchoolReason('2026-12-25'), /closed/, 'a listed closure');
assert.match(noSchoolReason('2026-08-10'), /closed|vacation/, 'summer vacation');
assert.equal(noSchoolReason('2026-10-30'), null, 'an open-but-unusual day (exam day) is still a school day');

const cal = { terms: [{ start: '2026-03-01', end: '2026-07-01' }, { start: '2026-08-26', end: '2027-01-06' }], closures: {} };
assert.match(noSchoolReason('2026-08-05', cal), /vacation/, 'between terms, nothing listed');
assert.equal(noSchoolReason('2027-03-03', cal), null, 'beyond the known calendar: weekdays are not declined');
assert.equal(noSchoolReason('not a date', cal), null);

/* --- the propose handler ------------------------------------------------ */

function makeRes() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    end(d) { this.body = JSON.parse(d); },
  };
}

async function run(date, { autoApprove = true } = {}) {
  const writes = [], teacherMail = [], studentMail = [], approved = [];
  const res = makeRes();
  const handler = createHandler({
    authenticate: async () => ({
      role: 'student', email: 'stu@example.com', name: 'Stu', studentId: 'stu1', studentName: 'Stu',
    }),
    sql: async (parts, ...values) => {
      const text = parts.join('?');
      if (/^\s*insert/i.test(text.trim())) { writes.push({ text, values }); return []; }
      return [];
    },
    loadBoard: async () => ({ students: [], proposals: [], leadDays: 7, lastRun: null }),
    send: (r, code, obj) => { r.status(code).end(JSON.stringify(obj)); },
    fail: (r, err) => { r.status(err.status || 500).end(JSON.stringify({ error: err.message })); },
    body: (req) => JSON.parse(req.body),
    seoulToday: () => '2026-10-14',
    PERIODS: [{ n: 1, start: '09:00', end: '09:40' }],
    CONFIG: { appUrl: 'https://example.invalid', notifyEmail: 'teacher@example.com' },
    emailTeacher: async (subject, lines) => { teacherMail.push({ subject, lines }); return true; },
    sendEmail: async (m) => { studentMail.push(m); return true; },
    whenLabel: () => 'a day',
    autoApproveEnabled: async () => autoApprove,
    leadDays: async () => 7,
    holdReasons: async () => [],
    approveProposal: async (id) => { approved.push(id); return { row: {}, eventId: 'e1' }; },
    autoApprovedEmail: () => ({ subject: 'approved', lines: [] }),
    noSchoolReason,
    newId: () => 'p-test',
  });
  await handler({
    method: 'POST', headers: {},
    body: JSON.stringify({ subject: 'Science', course: 'Life Science (5th ed.)', chapter: 'Ch 20', date }),
  }, res);
  return { res, writes, teacherMail, studentMail, approved };
}

// A Saturday: written as declined with the reason, student emailed (teacher cc), never approved.
{
  const { res, writes, studentMail, approved } = await run('2026-10-17');
  assert.equal(res.code, 200);
  assert.equal(res.body.autoDeclined, true);
  assert.equal(res.body.autoApproved, false);
  assert.match(res.body.message, /no school/);
  assert.equal(writes.length, 1);
  assert.match(writes[0].text, /'declined'/);
  assert.ok(writes[0].values.some((v) => /Declined automatically/.test(String(v))), 'the reason is stored');
  assert.equal(approved.length, 0, 'a no-school date must never be approved');
  assert.equal(studentMail.length, 1);
  assert.equal(studentMail[0].to, 'stu@example.com');
  assert.deepEqual(studentMail[0].cc, ['teacher@example.com']);
  assert.match(studentMail[0].subject, /declined/);
  assert.ok(studentMail[0].lines.some((l) => /Saturday/.test(l)));
}

// A listed closure (Christmas) is declined even with auto-approval switched off.
{
  const { res, approved, studentMail } = await run('2026-12-25', { autoApprove: false });
  assert.equal(res.body.autoDeclined, true);
  assert.equal(approved.length, 0);
  assert.equal(studentMail.length, 1);
}

// A school day is approved as before, and no student email is sent.
{
  const { res, writes, approved, studentMail, teacherMail } = await run('2026-10-15');
  assert.equal(res.code, 200);
  assert.equal(res.body.autoApproved, true);
  assert.ok(!res.body.autoDeclined);
  assert.equal(writes.length, 1);
  assert.doesNotMatch(writes[0].text, /'declined'/);
  assert.deepEqual(approved, ['p-test']);
  assert.equal(studentMail.length, 0);
  assert.equal(teacherMail[0].subject, 'approved');
}

console.log('no-school: all checks passed');
