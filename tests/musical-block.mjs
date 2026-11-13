/* A student cannot book a test during his own musical rehearsal (Mr. Ko,
 * 2026-11-13: "block students from booking slots that you know a musical
 * practice is scheduled for that student").
 *
 * Proves: the overlap rule (10+ minutes, grade must be taken out); a student
 * and Ezra are refused with nothing written; Mr. Ko signed in may still book;
 * a slot outside the rehearsal, or a grade the rehearsal does not take, goes
 * through as before.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { musicalClash, gradeNumber } from '../src/api/_musical.js';
import { createHandler } from '../src/api/_propose-core.mjs';

const PERIODS = [
  { n: 1, start: '09:00', end: '09:40' }, { n: 2, start: '09:45', end: '10:25' },
  { n: 3, start: '10:30', end: '11:10' }, { n: 4, start: '11:15', end: '11:55' },
  { n: 5, start: '13:05', end: '13:45' }, { n: 6, start: '13:50', end: '14:30' },
];
const BLOCKS = [
  { d: '2026-11-16', s: '09:45', e: '11:55', g: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { d: '2026-11-19', s: '16:00', e: '18:00', g: [5, 6, 7, 8] },
  { d: '2026-11-20', s: '13:50', e: '16:00', g: [5, 6, 7] },
];

/* --- the rule ----------------------------------------------------------- */
assert.equal(gradeNumber('G7E'), 7);
assert.equal(gradeNumber('G12'), 12);
assert.equal(gradeNumber(''), null);
assert.ok(musicalClash('2026-11-16', { period: 2 }, 'G8', PERIODS, BLOCKS), 'P2 inside the rehearsal');
assert.ok(musicalClash('2026-11-16', { period: 4 }, 'G12', PERIODS, BLOCKS), 'P4 inside the rehearsal');
assert.equal(musicalClash('2026-11-16', { period: 1 }, 'G8', PERIODS, BLOCKS), null, 'P1 ends before it starts');
assert.equal(musicalClash('2026-11-16', { period: 5 }, 'G8', PERIODS, BLOCKS), null, 'after lunch is free');
assert.ok(musicalClash('2026-11-16', { period: 1, periodEnd: 2 }, 'G8', PERIODS, BLOCKS), 'a pair touching it is blocked');
assert.equal(musicalClash('2026-11-20', { period: 6 }, 'G9', PERIODS, BLOCKS), null, 'grade not in that rehearsal');
assert.ok(musicalClash('2026-11-20', { period: 6 }, 'G7E', PERIODS, BLOCKS), 'G7E is grade 7');
assert.ok(musicalClash('2026-11-16', { time: '10:00' }, 'G8', PERIODS, BLOCKS), 'a typed time inside it');
assert.equal(musicalClash('2026-11-16', { period: 2 }, '', PERIODS, BLOCKS), null, 'no grade on the roster: let it through');
assert.equal(musicalClash('2026-11-17', { period: 2 }, 'G8', PERIODS, BLOCKS), null, 'another day');

/* --- the propose handler ------------------------------------------------ */
function makeRes() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
           end(d) { this.body = JSON.parse(d); } };
}
const SECRET = 'y'.repeat(40);
const hex = (s) => createHash('sha256').update(s).digest('hex');

async function run({ who = 'student', date = '2026-11-16', period = 2 } = {}) {
  const writes = [];
  const res = makeRes();
  const handler = createHandler({
    authenticate: async () => who === 'teacher'
      ? { role: 'teacher', email: 't@example.com', name: 'Mr. Ko' }
      : { role: 'student', email: 's@example.com', name: 'Stu', studentId: 'stu1', studentName: 'Stu' },
    sql: async (parts, ...values) => {
      const text = parts.join('?');
      if (/^\s*insert/i.test(text.trim())) { writes.push(values); return []; }
      if (/select grade from students/.test(text)) return [{ grade: 'G8' }];
      if (/from students where id/.test(text)) return [{ id: 'stu1', name: 'Stu', email: 's@example.com' }];
      return [];
    },
    loadBoard: async () => ({ students: [], proposals: [], leadDays: 7, lastRun: null }),
    send: (r, code, obj) => { r.status(code).end(JSON.stringify(obj)); },
    fail: (r, err) => { r.status(err.status || 500).end(JSON.stringify({ error: err.message })); },
    body: (req) => JSON.parse(req.body),
    seoulToday: () => '2026-11-13',
    PERIODS,
    CONFIG: { appUrl: 'https://example.invalid', notifyEmail: 't@example.com' },
    emailTeacher: async () => true, sendEmail: async () => true, whenLabel: () => 'a day',
    autoApproveEnabled: async () => true, leadDays: async () => 7, holdReasons: async () => [],
    approveProposal: async () => ({ row: {}, eventId: 'e1' }),
    autoApprovedEmail: () => ({ subject: 'ok', lines: [] }),
    bookingSecretHash: () => hex(SECRET),
    musicalClash: (d, s, g, p) => musicalClash(d, s, g, p, BLOCKS),
    newId: () => 'p-test',
  });
  const headers = who === 'ezra' ? { 'x-ezra-booking-secret': SECRET } : {};
  await handler({ method: 'POST', headers, body: JSON.stringify({
    subject: 'Science', course: 'Physical Science', chapter: 'Ch.03', date, period, studentId: 'stu1' }) }, res);
  return { res, writes };
}

{ const { res, writes } = await run();
  assert.equal(res.code, 409); assert.match(res.body.error, /musical practice/);
  assert.equal(writes.length, 0, 'nothing written for a refused slot'); }
{ const { res, writes } = await run({ who: 'ezra' });
  assert.equal(res.code, 409, 'Ezra cannot book into a rehearsal either'); assert.equal(writes.length, 0); }
{ const { res, writes } = await run({ who: 'teacher' });
  assert.equal(res.code, 200, 'Mr. Ko may still book it himself'); assert.equal(writes.length, 1); }
{ const { res, writes } = await run({ period: 5 });
  assert.equal(res.code, 200, 'a free period is booked as before'); assert.equal(writes.length, 1); }

console.log('musical-block: all checks passed');
