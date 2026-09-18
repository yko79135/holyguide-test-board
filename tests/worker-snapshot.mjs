import assert from 'node:assert/strict';
import { createHandler, CUTOFF_UTC } from '../src/api/_worker-snapshot-core.mjs';

async function run({ method = 'GET', supplied = 'fixture', expected = 'fixture', rows = [], settings = [], fail = false } = {}) {
  const queries = [];
  const sql = async (parts, ...values) => {
    const text = parts.join('?');
    queries.push({ text, values });
    assert.match(text.trim(), /^select /i);
    assert.doesNotMatch(text, /\b(update|insert|delete|claim|deliver)\b/i);
    if (fail) throw new Error('sensitive-provider-data');
    if (text.includes('from proposals')) return rows;
    if (text.includes('from settings')) return settings;
    return [{ ok: 1 }];
  };
  const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, end(data) { this.data = data; } };
  const send = (res, code, data) => { res.setHeader('cache-control', 'no-store'); res.status(code).end(data); };
  await createHandler({ sql, send, secret: () => expected })(
    { method, headers: { 'x-build-secret': supplied }, query: { since: '2000-01-01' } }, response);
  return { response, queries };
}
for (const options of [{ supplied: '' }, { supplied: 'wrong' }, { expected: '' }]) {
  const { response, queries } = await run(options);
  assert.equal(response.code, 401); assert.equal(queries.length, 0);
}
for (const method of ['POST', 'PUT', 'DELETE']) {
  const { response, queries } = await run({ method });
  assert.equal(response.code, 405); assert.equal(queries.length, 0);
}
let result = await run({ method: 'HEAD' });
assert.equal(result.response.code, 200); assert.equal(result.response.data, undefined);
assert.equal(result.queries.length, 1); assert.match(result.queries[0].text, /select 1/);
result = await run();
assert.equal(result.response.code, 200); assert.deepEqual(result.response.data.proposals, []);
assert.equal(result.response.headers['cache-control'], 'no-store');
assert.deepEqual(result.queries[0].values, [CUTOFF_UTC, CUTOFF_UTC]);
assert.match(result.queries[0].text, /p.created_at >=/); assert.match(result.queries[0].text, /p.decided_at >=/);
assert.match(result.queries[0].text, /p.status = 'approved'/); assert.match(result.queries[0].text, /p.test_date >=/);
const student = { id: 'fixture-student', email: 'fixture@example.invalid' };
result = await run({ rows: [{ id: 'p1', student }, { id: 'p2', student }] });
assert.equal(result.response.data.students.length, 1);
assert.equal(result.response.data.proposals.length, 2);
assert.equal(result.response.data.proposals[0].student, undefined);
assert.equal((await run({ rows: Array(501).fill({ student }) })).response.code, 503);
assert.equal((await run({ settings: [{ value: 'bad' }] })).response.code, 503);
result = await run({ fail: true });
assert.equal(result.response.code, 503); assert.doesNotMatch(JSON.stringify(result.response.data), /sensitive/);
console.log('PASS authentication, method refusal, HEAD no records, fixed cutoff, bounded read-only snapshot, roster minimization, fail-closed errors; no network or sends');
