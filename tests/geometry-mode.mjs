/* Geometry mode — the one field a Geometry proposal cannot be without.
 *
 * Geometry runs two test formats and the desktop build queue refuses a
 * reservation that does not say which ('Choose BJU or six demonstrated
 * chapter proofs for this Geometry test.'). This proves the board now asks,
 * refuses a Geometry proposal without an answer, and leaves every other
 * course exactly as it was.
 */
import assert from 'node:assert/strict';
import { isGeometry, geometryModeLabel, GEOMETRY_MODES, materialKind } from '../src/api/_materials.js';
import { createHandler } from '../src/api/_propose-core.mjs';

/* --- pure helpers ------------------------------------------------------- */

assert.equal(isGeometry('Math', 'Geometry (4th ed.)'), true);
assert.equal(isGeometry('Math', 'geometry'), true);
assert.equal(isGeometry('Math', 'Algebra 1 (3rd ed.)'), false);
assert.equal(isGeometry('Math', ''), false);
assert.equal(isGeometry('Math', null), false);
// Science never asks, even if a course name somehow contains the word.
assert.equal(isGeometry('Science', 'Geometry of Crystals'), false);

assert.equal(geometryModeLabel('bju'), 'BJU chapter test');
assert.equal(geometryModeLabel('proofs'), 'Six demonstrated chapter proofs');
assert.equal(geometryModeLabel(null), '');
assert.equal(geometryModeLabel('something-else'), '');
assert.deepEqual(GEOMETRY_MODES, ['bju', 'proofs']);

// Geometry is still Math, so it is still a practice test that gets delivered.
assert.equal(materialKind('Math'), 'Practice Test');

/* --- the propose handler ------------------------------------------------ */

const PERIODS = [{ n: 1, start: '09:00', end: '09:40' }];

function makeRes() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    end(d) { this.body = JSON.parse(d); },
  };
}

async function run(payload) {
  const writes = [];
  const mail = [];
  const res = makeRes();

  const handler = createHandler({
    authenticate: async () => ({
      role: 'student', email: 's@example.com', name: 'Test',
      studentId: 'stu1', studentName: 'Test',
    }),
    sql: async (parts, ...values) => {
      const text = parts.join('?');
      if (/^\s*insert/i.test(text.trim())) { writes.push({ text, values }); return []; }
      return []; // no clashing proposal already on the board
    },
    loadBoard: async () => ({ students: [], proposals: [], leadDays: 7, lastRun: null }),
    send: (r, code, obj) => { r.status(code).end(JSON.stringify(obj)); },
    fail: (r, err) => { r.status(err.status || 500).end(JSON.stringify({ error: err.message })); },
    body: (req) => JSON.parse(req.body),
    seoulToday: () => '2026-09-22',
    PERIODS,
    CONFIG: { appUrl: 'https://example.invalid' },
    emailTeacher: async (subject, lines) => { mail.push({ subject, lines }); return true; },
    whenLabel: () => 'a day',
    autoApproveEnabled: async () => false,
    leadDays: async () => 7,
    holdReasons: async () => [],
    approveProposal: async () => ({ row: {}, eventId: null }),
    autoApprovedEmail: () => ({ subject: '', lines: [] }),
    newId: () => 'p-test',
  });

  await handler({ method: 'POST', headers: {}, body: JSON.stringify(payload) }, res);
  return { res, writes, mail };
}

const base = { subject: 'Math', chapter: 'Ch 1', date: '2026-11-01' };
const GEO = 'Geometry (4th ed.)';

// A Geometry proposal with no format is refused, and nothing is written.
{
  const { res, writes } = await run({ ...base, course: GEO });
  assert.equal(res.code, 400);
  assert.match(res.body.error, /BJU chapter test|six demonstrated/i);
  assert.equal(writes.length, 0, 'a refused proposal must not reach the database');
}

// An unrecognised format is refused too — never silently stored or defaulted.
{
  const { res, writes } = await run({ ...base, course: GEO, geometryMode: 'whatever' });
  assert.equal(res.code, 400);
  assert.equal(writes.length, 0);
}

// Both real formats are accepted, stored, and named to Mr. Ko in the email.
for (const mode of GEOMETRY_MODES) {
  const { res, writes, mail } = await run({ ...base, course: GEO, geometryMode: mode });
  assert.equal(res.code, 200, 'expected ' + mode + ' to be accepted');
  assert.equal(writes.length, 1);
  assert.match(writes[0].text, /geometry_mode/);
  assert.ok(writes[0].values.includes(mode), 'the chosen format must be the value stored');
  assert.ok(
    mail[0].lines.some((l) => l === 'Format: ' + geometryModeLabel(mode)),
    'the teacher email must say which format was chosen'
  );
}

// Every other course is unaffected, and stores NULL rather than a guess.
{
  const { res, writes, mail } = await run({ ...base, course: 'Algebra 1 (3rd ed.)' });
  assert.equal(res.code, 200);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].values.includes(null), 'non-Geometry rows must store NULL, not a default');
  assert.ok(!mail[0].lines.some((l) => /^Format:/.test(l)), 'no format line for a non-Geometry test');
}

// A format sent for a non-Geometry course is discarded, not attached to it.
{
  const { res, writes } = await run({
    ...base, course: 'Algebra 1 (3rd ed.)', geometryMode: 'proofs',
  });
  assert.equal(res.code, 200);
  assert.ok(!writes[0].values.includes('proofs'), 'a format must not attach to a non-Geometry test');
}

// Science is untouched by all of this.
{
  const { res, writes } = await run({
    subject: 'Science', course: 'Earth Science (5th ed.)', chapter: 'Ch 3', date: '2026-11-01',
  });
  assert.equal(res.code, 200);
  assert.ok(writes[0].values.includes(null));
}

// The rest of the handler still works: bad date, bad period, duplicate.
{
  const { res } = await run({ ...base, course: GEO, geometryMode: 'bju', date: '2020-01-01' });
  assert.equal(res.code, 400);
  assert.match(res.body.error, /future/i);
}
{
  const { res } = await run({ ...base, course: GEO, geometryMode: 'bju', period: 99 });
  assert.equal(res.code, 400);
  assert.match(res.body.error, /school periods/i);
}

console.log('geometry-mode: all assertions passed');
