/* Mr. Ko or Ezra books a test for a named student (Mr. Ko, 2026-11-03).
 *
 * Proves: the booking secret is required and checked exactly; a teacher
 * booking needs a studentId that is on the roster; the row is written for
 * that student (not for the teacher) and marked "Booked by"; it then goes
 * through the same auto-approval as a student's own request; a student
 * still books only for himself (a studentId he sends is ignored).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHandler } from '../src/api/_propose-core.mjs';

const SECRET = 'x'.repeat(40);
const hex = (s) => createHash('sha256').update(s).digest('hex');

function makeRes() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    end(d) { this.body = JSON.parse(d); },
  };
}

async function run({ headers = {}, payload = {}, role = 'student', secret = SECRET } = {}) {
  const writes = [], approved = [];
  let authCalls = 0;
  const res = makeRes();
  const handler = createHandler({
    authenticate: async () => {
      authCalls++;
      return role === 'teacher'
        ? { role: 'teacher', email: 'teacher@example.com', name: 'Mr. Ko' }
        : { role: 'student', email: 'stu@example.com', name: 'Stu', studentId: 'stu1', studentName: 'Stu' };
    },
    sql: async (parts, ...values) => {
      const text = parts.join('?');
      if (/^\s*insert/i.test(text.trim())) { writes.push({ text, values }); return []; }
      if (/from students where id/.test(text)) {
        return values[0] === 'yoonchan' ? [{ id: 'yoonchan', name: 'Yoonchan', email: 'yc@example.com' }] : [];
      }
      return [];
    },
    loadBoard: async () => ({ students: [], proposals: [], leadDays: 7, lastRun: null }),
    send: (r, code, obj) => { r.status(code).end(JSON.stringify(obj)); },
    fail: (r, err) => { r.status(err.status || 500).end(JSON.stringify({ error: err.message })); },
    body: (req) => JSON.parse(req.body),
    seoulToday: () => '2026-11-03',
    PERIODS: [{ n: 3, start: '10:30', end: '11:10' }],
    CONFIG: { appUrl: 'https://example.invalid', notifyEmail: 'teacher@example.com' },
    emailTeacher: async () => true,
    sendEmail: async () => true,
    whenLabel: () => 'a day',
    autoApproveEnabled: async () => true,
    leadDays: async () => 7,
    holdReasons: async () => [],
    approveProposal: async (id) => { approved.push(id); return { row: {}, eventId: 'e1' }; },
    autoApprovedEmail: () => ({ subject: 'approved', lines: [] }),
    noSchoolReason: () => null,
    bookingSecretHash: () => (secret ? hex(secret) : ''),
    newId: () => 'p-test',
  });
  await handler({
    method: 'POST', headers,
    body: JSON.stringify({ subject: 'Science', course: 'Physical Science (6th ed.)', chapter: 'Ch.02',
                           date: '2026-11-10', period: 3, ...payload }),
  }, res);
  return { res, writes, approved, authCalls };
}

// Ezra with the right secret books for Yoonchan: written for him, approved.
{
  const { res, writes, approved, authCalls } = await run({
    headers: { 'x-ezra-booking-secret': SECRET }, payload: { studentId: 'yoonchan' } });
  assert.equal(res.code, 200);
  assert.equal(res.body.autoApproved, true);
  assert.equal(authCalls, 0, 'the secret path does not need Google sign-in');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].values[1], 'yoonchan', 'row belongs to the named student');
  assert.ok(writes[0].values.some((v) => /^Booked by Ezra\./.test(String(v))), 'marked as booked by Ezra');
  assert.deepEqual(approved, ['p-test']);
}

// Wrong secret, empty secret, or no secret configured: refused, nothing written.
for (const [hdr, secret] of [['y'.repeat(40), SECRET], ['', SECRET], [SECRET.slice(0, 39), SECRET], ['', ''], ['short', 'short']]) {
  const { res, writes } = await run({ headers: { 'x-ezra-booking-secret': hdr }, payload: { studentId: 'yoonchan' }, secret });
  assert.equal(res.code, 401, 'refused: ' + JSON.stringify([hdr.length, secret.length]));
  assert.equal(writes.length, 0);
}

// Secret is fine but no student / unknown student.
{
  const a = await run({ headers: { 'x-ezra-booking-secret': SECRET } });
  assert.equal(a.res.code, 400); assert.equal(a.writes.length, 0);
  const b = await run({ headers: { 'x-ezra-booking-secret': SECRET }, payload: { studentId: 'nobody' } });
  assert.equal(b.res.code, 404); assert.equal(b.writes.length, 0);
}

// Mr. Ko signed in books for a student.
{
  const { res, writes } = await run({ role: 'teacher', payload: { studentId: 'yoonchan' } });
  assert.equal(res.code, 200);
  assert.equal(writes[0].values[1], 'yoonchan');
  assert.ok(writes[0].values.some((v) => /^Booked by Mr\. Ko\./.test(String(v))));
}

// A student cannot book for someone else: studentId is ignored.
{
  const { res, writes } = await run({ payload: { studentId: 'yoonchan', note: 'hi' } });
  assert.equal(res.code, 200);
  assert.equal(writes[0].values[1], 'stu1');
  assert.ok(writes[0].values.includes('hi'), 'a student note is stored unchanged');
}

console.log('ezra-booking: all checks passed');
