/* Re-applying for a test that was missed.
 *
 * A student who was ill on his test day still has the old approved row on
 * the board, in the past. The duplicate-chapter guard used to see that row
 * and refuse him a new date for the same chapter — permanently, with no way
 * out on his side (withdraw only works on 'pending').
 *
 * The guard now looks only at dates that have not happened yet. A past row
 * no longer blocks; a future one still does, so this is not a way to hold
 * two dates for one chapter at once.
 */
import assert from 'node:assert/strict';
import { createHandler } from '../src/api/_propose-core.mjs';

const TODAY = '2026-09-23';
const PERIODS = [{ n: 5, start: '13:05', end: '13:45' }];

function makeRes() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    end(d) { this.body = JSON.parse(d); },
  };
}

/* `existing` are the rows already on the board for this student+chapter,
   filtered here exactly as Postgres would filter them, so the test proves
   the WHERE clause and not just the JavaScript around it. */
async function run(payload, existing = []) {
  const writes = [];
  const res = makeRes();
  const queries = [];

  const handler = createHandler({
    authenticate: async () => ({
      role: 'student', email: 's@example.invalid', name: 'Test',
      studentId: 'stu1', studentName: 'Test',
    }),
    sql: async (parts, ...values) => {
      const text = parts.join('?');
      queries.push(text);
      if (/^\s*insert/i.test(text.trim())) { writes.push({ text, values }); return []; }
      if (/from proposals/i.test(text)) {
        const [studentId, subject, chapter, today] = values;
        return existing
          .filter((r) => r.student_id === studentId
            && r.subject === subject
            && r.chapter.toLowerCase() === String(chapter).toLowerCase()
            && ['pending', 'approved'].includes(r.status)
            && r.test_date >= today)
          .slice(0, 1)
          .map((r) => ({ test_date: r.test_date }));
      }
      return [];
    },
    loadBoard: async () => ({ students: [], proposals: [], leadDays: 7, lastRun: null }),
    send: (r, code, obj) => { r.status(code).end(JSON.stringify(obj)); },
    fail: (r, err) => { r.status(err.status || 500).end(JSON.stringify({ error: err.message })); },
    body: (req) => JSON.parse(req.body),
    seoulToday: () => TODAY,
    PERIODS,
    CONFIG: { appUrl: 'https://example.invalid' },
    emailTeacher: async () => true,
    whenLabel: () => 'a day',
    autoApproveEnabled: async () => false,
    leadDays: async () => 7,
    holdReasons: async () => [],
    approveProposal: async () => ({ row: {}, eventId: null }),
    autoApprovedEmail: () => ({ subject: '', lines: [] }),
    newId: () => 'p-test',
  });

  await handler({ method: 'POST', headers: {}, body: JSON.stringify(payload) }, res);
  return { res, writes, queries };
}

const missed = {
  student_id: 'stu1', subject: 'Science', chapter: 'Ch.9',
  status: 'approved', test_date: '2026-09-16', // already past
};
const upcoming = {
  student_id: 'stu1', subject: 'Science', chapter: 'Ch.9',
  status: 'approved', test_date: '2026-10-05', // still ahead
};
const proposal = {
  subject: 'Science', course: 'Physical Science (6th ed.)',
  chapter: 'Ch.9', date: '2026-10-02', period: 5,
  note: 'I was sick on the first date.',
};

/* 1. The case that was broken: a missed test no longer blocks a new one. */
{
  const { res, writes } = await run(proposal, [missed]);
  assert.equal(res.code, 200, 'a missed chapter must be bookable again: ' + JSON.stringify(res.body));
  assert.equal(writes.length, 1, 'the new proposal row should be written');
  assert.ok(writes[0].values.includes('2026-10-02'));
}

/* 2. Still one live date per chapter. */
{
  const { res } = await run(proposal, [upcoming]);
  assert.equal(res.code, 409, 'a future date for the same chapter must still block');
  assert.match(res.body.error, /2026-10-05/, 'the refusal should say which date is in the way');
  assert.match(res.body.error, /[Ww]ithdraw/, 'and how to get out of it');
}

/* 3. A date exactly today still blocks — the test has not happened yet. */
{
  const { res } = await run(proposal, [{ ...upcoming, test_date: TODAY }]);
  assert.equal(res.code, 409, "today's test still counts as booked");
}

/* 4. A different chapter was never blocked and still is not. */
{
  const { res } = await run({ ...proposal, chapter: 'Ch.10' }, [missed, upcoming]);
  assert.equal(res.code, 200, 'another chapter is unaffected');
}

/* 5. The guard is comparing against a date, not a timestamp string. */
{
  const { queries } = await run(proposal, [missed]);
  const guard = queries.find((q) => /from proposals/i.test(q));
  assert.match(guard, /test_date\s*>=\s*\?::date/, 'the cutoff must be cast to a date');
}

console.log('reapply-after-missed-test: all assertions passed');
