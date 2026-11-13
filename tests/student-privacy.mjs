/* Students see only their own test dates (Mr. Ko, 2026-11-13: "prevent
 * students from seeing other students' test dates"). */
import assert from 'node:assert/strict';
import { boardFor } from '../src/api/_privacy.js';

const board = {
  students: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  proposals: [{ id: 'p1', student_id: 'a', test_date: '2026-11-20' },
              { id: 'p2', student_id: 'b', test_date: '2026-11-21' }],
  leadDays: 7, lastRun: { ran_at: 'x' },
};

const a = boardFor(board, { role: 'student', studentId: 'a' });
assert.deepEqual(a.proposals.map((p) => p.id), ['p1'], 'only his own rows');
assert.deepEqual(a.students.map((s) => s.id), ['a'], 'only his own roster entry');
assert.equal(a.lastRun, null, 'no run counts for students');
assert.equal(a.leadDays, 7);

const t = boardFor(board, { role: 'teacher' });
assert.equal(t.proposals.length, 2, 'Mr. Ko sees everything');
assert.equal(t.students.length, 2);

for (const v of [undefined, null, {}, { role: 'student' }]) {
  const x = boardFor(board, v);
  assert.equal(x.proposals.length, 0, 'unknown viewer sees nothing');
  assert.equal(x.students.length, 0);
}
assert.equal(board.proposals.length, 2, 'the original is not changed');
console.log('student-privacy: all checks passed');
