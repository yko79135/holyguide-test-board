/* The teacher can take a missed test off the board.
 *
 * A student who was ill still has an approved row sitting in the past, and
 * that row reserves his chapter. decide.js has always accepted a decline on
 * it; the teacher view simply never drew the button — an approved row got
 * "Move back to pending" (which makes it pending, still reserved) and a row
 * in the past got nothing at all. So the only way out of the reservation was
 * not reachable from the screen.
 *
 * This loads app.js in a headless Chrome as the teacher, against a stub
 * board holding one past approved test, and clicks the button.
 *
 * Run: node tests/browser-decline-past-test.mjs   (needs google-chrome on PATH)
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
              periods: [{ n: 5, start: '13:05', end: '13:45' }] };

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
        if (p.id === lastDecide.id && lastDecide.decision === 'decline') p.status = 'declined';
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
const chrome = spawn('google-chrome', [
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
    if (document.querySelector('[data-act="decline"][data-id="p-missed"]')
        || Date.now() - t0 > 10000) {
      return document.querySelector('.rows') ? res(true) : rej(new Error('board never rendered'));
    }
    setTimeout(poll, 50);
  })();
})`);

const results = {};

/* 1. The past approved test now offers a way off the board. */
results.pastHasDecline = await evaluate(
  `!!document.querySelector('[data-act="decline"][data-id="p-missed"]')`
);
assert.equal(results.pastHasDecline, true,
  'a past approved test must have a decline button — it is the only way to free the chapter');

/* 2. Worded for what it is, not as a bare "Decline". */
results.pastLabel = await evaluate(
  `document.querySelector('[data-act="decline"][data-id="p-missed"]').textContent`
);
assert.match(results.pastLabel, /free the chapter/i);

/* 3. Reopen is NOT offered on a sent row, and is not the escape anyway. */
results.pastHasReopen = await evaluate(
  `!!document.querySelector('[data-act="reopen"][data-id="p-missed"]')`
);
assert.equal(results.pastHasReopen, false, 'materials already went out — reopen would resend');

/* 4. A future approved test keeps both: reopen to adjust, cancel to drop. */
results.futureHasReopen = await evaluate(
  `!!document.querySelector('[data-act="reopen"][data-id="p-future"]')`
);
results.futureLabel = await evaluate(
  `(document.querySelector('[data-act="decline"][data-id="p-future"]')||{}).textContent || ''`
);
assert.equal(results.futureHasReopen, true);
assert.match(results.futureLabel, /cancel this test/i);

/* 5. Clicking it actually calls decide with decision=decline. */
if (process.env.SHOT_BEFORE) {
  const s0 = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, S);
  fs.writeFileSync(process.env.SHOT_BEFORE, Buffer.from(s0.result.data, 'base64'));
}
await evaluate(`document.querySelector('[data-act="decline"][data-id="p-missed"]').click()`);
await new Promise((r) => setTimeout(r, 600));
assert.ok(lastDecide, 'the click should have reached /api/decide');
assert.equal(lastDecide.id, 'p-missed');
assert.equal(lastDecide.decision, 'decline');

if (process.env.SHOT) {
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, S);
  fs.writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'));
}

ws.close();
chrome.kill();
server.close();
fs.rmSync(userDir, { recursive: true, force: true });

console.log('browser-decline-past-test: all assertions passed');
console.log(JSON.stringify(results, null, 2));
