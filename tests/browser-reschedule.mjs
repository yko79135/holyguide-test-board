/* The teacher can move an approved test to another day without it going
 * back to pending.
 *
 * "Move back to pending" was the only way to change a date, and it threw
 * away the approval, the calendar event and the delivery state, then asked
 * Mr. Ko to approve the same test again. Reschedule keeps the row approved
 * and sends decide.js the new date and period.
 *
 * Run: node tests/browser-reschedule.mjs
 *      (needs google-chrome on PATH, or CHROME=/path/to/chromium)
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const SRC = path.join(import.meta.dirname, '..', 'src');
const TODAY = '2026-09-23';

const BOARD = {
  me: { role: 'teacher', email: 'teacher@example.invalid' },
  today: TODAY,
  leadDays: 7,
  students: [{ id: 'stu1', name: 'Student', grade: '8', email: 's@example.invalid',
               email_confirmed: true, math_course: 'Algebra 1 (3rd ed.)',
               science_course: 'Physical Science (6th ed.)' }],
  proposals: [
    /* Sat in the past, never taken. This is the row that blocks. */
    { id: 'p-missed', student_id: 'stu1', subject: 'Science',
      course: 'Physical Science (6th ed.)', chapter: 'Ch.9',
      test_date: '2026-09-16', test_period: 5, test_time: '13:05',
      status: 'approved', delivery_status: 'sent', sent_at: '2026-09-09',
      files: [], note: '' },
    /* Still ahead, materials not out yet. */
    { id: 'p-future', student_id: 'stu1', subject: 'Math',
      course: 'Algebra 1 (3rd ed.)', chapter: 'Ch.2',
      test_date: '2026-10-05', test_period: 5, test_time: '13:05',
      status: 'approved', delivery_status: 'scheduled', sent_at: null,
      files: [], note: '' },
  ],
  lastRun: null,
};
const CFG = { configured: true, googleClientId: 'x', calendar: false,
              periods: [{ n: 3, start: '10:40', end: '11:20' },
                        { n: 5, start: '13:05', end: '13:45' }] };

let lastDecide = null;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (url === '/api/config') return json(CFG);
  if (url === '/api/board') return json(BOARD);
  if (url === '/api/decide') {
    let b = '';
    req.on('data', (c) => { b += c; });
    return req.on('end', () => {
      lastDecide = JSON.parse(b || '{}');
      /* Answer the way the real endpoint does: the decided row comes back
         declined, so the UI has to re-render from it. */
      const next = JSON.parse(JSON.stringify(BOARD));
      for (const p of next.proposals) {
        if (p.id === lastDecide.id && lastDecide.decision === 'reschedule') {
          p.test_date = lastDecide.date; p.test_period = lastDecide.period;
        }
      }
      json(next);
    });
  }
  const file = url === '/' ? '/index.html' : url;
  const full = path.join(SRC, file);
  if (!full.startsWith(SRC) || !fs.existsSync(full)) { res.statusCode = 404; return res.end('no'); }
  const type = full.endsWith('.js') ? 'text/javascript' : full.endsWith('.css') ? 'text/css' : 'text/html';
  res.setHeader('content-type', type);
  res.end(fs.readFileSync(full));
});

await new Promise((r) => server.listen(0, r));
const origin = 'http://127.0.0.1:' + server.address().port;

const userDir = fs.mkdtempSync('/tmp/tdb-chrome-');
const chrome = spawn(process.env.CHROME || 'google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=' + userDir, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('chrome did not start')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(t); resolve(m[0]); }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => { ws.onopen = r; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function cmd(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const { result: target } = await cmd('Target.createTarget', { url: 'about:blank' });
const { result: att } = await cmd('Target.attachToTarget', { targetId: target.targetId, flatten: true });
const S = att.sessionId;
await cmd('Page.enable', {}, S);
await cmd('Runtime.enable', {}, S);

async function evaluate(expression) {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, S);
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description || 'page threw');
  }
  return r.result.result.value;
}

await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try { sessionStorage.setItem('tdb.token', 'test-token'); } catch (e) {}
    window.google = { accounts: { id: {
      initialize(){}, renderButton(){}, prompt(){}, disableAutoSelect(){},
    } } };
  `,
}, S);

await cmd('Page.navigate', { url: origin + '/' }, S);
await evaluate(`new Promise((res, rej) => {
  const t0 = Date.now();
  (function poll(){
    if (document.querySelector('[data-act="resched-open"]')) return res(true);
    if (Date.now() - t0 > 10000) return rej(new Error('board never rendered'));
    setTimeout(poll, 50);
  })();
})`);

const results = {};

/* 1. Every approved row — upcoming, or past and never sat — offers it,
      including one whose materials already went out. */
results.futureHas = await evaluate(`!!document.querySelector('[data-act="resched-open"][data-id="p-future"]')`);
results.missedHas = await evaluate(`!!document.querySelector('[data-act="resched-open"][data-id="p-missed"]')`);
assert.equal(results.futureHas, true);
assert.equal(results.missedHas, true);

/* 2. Opening it shows the editor, prefilled with the current slot. */
await evaluate(`document.querySelector('[data-act="resched-open"][data-id="p-future"]').click()`);
results.prefilledDate = await evaluate(`document.querySelector('[data-field="r-date"]').value`);
results.prefilledSlot = await evaluate(`document.querySelector('[data-field="r-slot"]').value`);
assert.equal(results.prefilledDate, '2026-10-05');
assert.equal(results.prefilledSlot, '5');

/* 3. Change the date and period, save: decide gets a reschedule, not a reopen. */
await evaluate(`(() => {
  const d = document.querySelector('[data-field="r-date"]');
  d.value = '2026-10-08'; d.dispatchEvent(new Event('input', { bubbles: true }));
  const s = document.querySelector('[data-field="r-slot"]');
  s.value = '3'; s.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await evaluate(`document.querySelector('[data-act="resched-save"][data-id="p-future"]').click()`);
await new Promise((r) => setTimeout(r, 600));
assert.ok(lastDecide, 'the click should have reached /api/decide');
results.sent = lastDecide;
assert.deepEqual(lastDecide, { id: 'p-future', decision: 'reschedule', date: '2026-10-08', period: 3, time: '' });

/* 4. Editor closes and the row still reads Approved, on the new date. */
results.editorGone = await evaluate(`!document.querySelector('.resched')`);
results.rowText = await evaluate(
  `document.querySelector('[data-act="resched-open"][data-id="p-future"]').closest('.row').textContent`
);
assert.equal(results.editorGone, true);
assert.match(results.rowText, /October 8, 2026/);
assert.match(results.rowText, /Approved/);

if (process.env.SHOT) {
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, S);
  fs.writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'));
}

ws.close();
/* Wait for Chrome to go, or it is still writing its profile while we delete it. */
await new Promise((r) => { chrome.once('exit', r); chrome.kill(); });
server.close();
fs.rmSync(userDir, { recursive: true, force: true });

console.log('browser-reschedule: all assertions passed');
console.log(JSON.stringify(results, null, 2));
