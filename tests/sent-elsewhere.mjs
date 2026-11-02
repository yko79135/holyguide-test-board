import assert from 'node:assert/strict';
import { sentElsewhere } from '../src/api/_sent-elsewhere.js';
import SENDS from '../src/api/_sent-elsewhere-data.js';

const fixture = [{ reservation: 'r1', kind: 'Study Guide', at: '2026-10-20T03:06:01Z', by: 'Ezra' }];
assert.equal(sentElsewhere('r1', 'Study Guide', fixture).at, '2026-10-20T03:06:01Z');
assert.equal(sentElsewhere('r1', 'study-guide', fixture).by, 'Ezra');
assert.equal(sentElsewhere('r1', 'Practice Test', fixture), null, 'a different kind is not sent');
assert.equal(sentElsewhere('r2', 'Study Guide', fixture), null, 'a different test is not sent');
assert.equal(sentElsewhere('r1', 'Study Guide', undefined ?? []), null);
assert.ok(Array.isArray(SENDS));
for (const e of SENDS) assert.deepEqual(Object.keys(e).sort(), ['at', 'by', 'kind', 'reservation'], 'no personal fields');
console.log('sent-elsewhere: match by reservation + kind, no personal fields, ' + SENDS.length + ' mirrored entries passed.');
