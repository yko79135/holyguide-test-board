/* Two back-to-back periods (Mr. Ko, 2026-11-06): a test may take one
   period or two consecutive ones, never across lunch (after 4교시). */
import assert from 'node:assert/strict';
import { readSlot, periodSpan, canPair } from '../src/api/_slots.js';

const P = [
  { n: 1, start: '09:00', end: '09:40' }, { n: 2, start: '09:45', end: '10:25' },
  { n: 3, start: '10:30', end: '11:10' }, { n: 4, start: '11:15', end: '11:55' },
  { n: 5, start: '13:05', end: '13:45' }, { n: 6, start: '13:50', end: '14:30' },
  { n: 7, start: '14:35', end: '15:15' }, { n: 8, start: '15:20', end: '16:00' },
];

assert.deepEqual(readSlot({ period: 3 }, P), { period: 3, periodEnd: null, time: '10:30' });
assert.deepEqual(readSlot({ period: 3, periodEnd: 4 }, P), { period: 3, periodEnd: 4, time: '10:30' });
assert.deepEqual(readSlot({ period: 3, periodEnd: 3 }, P), { period: 3, periodEnd: null, time: '10:30' });
assert.match(readSlot({ period: 3, periodEnd: 5 }, P).error, /back to back/);
assert.match(readSlot({ period: 4, periodEnd: 5 }, P).error, /lunch/);
assert.match(readSlot({ period: 8, periodEnd: 9 }, P).error, /back to back/);
assert.match(readSlot({}, P).error, /class period/);
assert.match(readSlot({ period: 99 }, P).error, /school periods/);
assert.deepEqual(readSlot({ time: '16:30' }, P), { period: null, periodEnd: null, time: '16:30' });
assert.equal(canPair(4, P), false);
assert.equal(canPair(8, P), false);
assert.equal(canPair(7, P), true);

assert.deepEqual(periodSpan({ test_period: 3, test_period_end: 4 }, P), { start: '10:30', end: '11:55', label: '3–4교시' });
assert.deepEqual(periodSpan({ test_period: 3, test_period_end: null }, P), { start: '10:30', end: '11:10', label: '3교시' });
assert.equal(periodSpan({ test_period: null }, P), null);

console.log('two-periods: all assertions passed');
