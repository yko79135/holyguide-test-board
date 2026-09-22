/* A real browser exercise of the Geometry format field.
 *
 * The unit tests prove the server refuses a Geometry proposal without a
 * format. This proves the student is actually asked: app.js is loaded in a
 * headless Chrome against a stub board, and the field is clicked.
 *
 * Run: node tests/browser-geometry-mode.mjs   (needs google-chrome on PATH)
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const SRC = path.join(import.meta.dirname, '..', 'src');

const BOARD = {
  me: { role: 'student', email: 's@example.com', studentId: 'stu1' },
  today: '2026-09-22',
  leadDays: 7,
  students: [{ id: 'stu1', name: 'Student', math_course: 'Geometry (4th ed.)', science_course: 'Earth Science (5th ed.)' }],
  proposals: [],
  lastRun: null,
};
const CFG = { configured: true, googleClientId: 'x', periods: [{ n: 1, start: '09:00', end: '09:40' }] };

let lastPropose = null;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (url === '/api/config') return json(CFG);
  if (url === '/api/board') return json(BOARD);
  if (url === '/api/propose') {
    let b = '';
    req.on('data', (c) => { b += c; });
    return req.on('end', () => {
      lastPropose = JSON.parse(b || '{}');
      json(BOARD);
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
const port = server.address().port;
const origin = 'http://127.0.0.1:' + port;

/* Drive Chrome over the DevTools protocol. No puppeteer in this project and
   this needs three commands, which is cheaper than a dependency. */
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

const { WebSocket } = await import('node:worker_threads').then(() => globalThis);
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
  const r = await cmd('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  }, S);
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description || 'page threw');
  }
  return r.result.result.value;
}

/* app.js gates on a sign-in token in sessionStorage, and index.html pulls
   Google's GSI script from the network, which headless has no reason to
   reach. Plant the token and a stub google object before any page script
   runs, so the board renders as a signed-in student. */
await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try { sessionStorage.setItem('tdb.token', 'test-token'); } catch (e) {}
    window.google = { accounts: { id: {
      initialize(){}, renderButton(){}, prompt(){}, disableAutoSelect(){},
    } } };
  `,
}, S);

await cmd('Page.navigate', { url: origin + '/' }, S);
// Wait for the app to have rendered the proposal form.
await evaluate(`new Promise((res, rej) => {
  const t0 = Date.now();
  (function poll(){
    if (document.getElementById('f-course')) return res(true);
    if (Date.now() - t0 > 10000) return rej(new Error('form never rendered'));
    setTimeout(poll, 50);
  })();
})`);

const results = {};

// Math + Geometry course => the format buttons are shown.
results.shownForGeometry = await evaluate(
  `!!document.querySelector('.geo-modes') &&
   [...document.querySelectorAll('.geo-modes button')].map(b => b.textContent).join('|')`
);
assert.equal(results.shownForGeometry, 'BJU chapter test|Six demonstrated chapter proofs');

// Nothing chosen yet => the warning hint is up.
results.warnsBeforeChoosing = await evaluate(
  `!!document.querySelector('.geo-modes').parentNode.querySelector('.hint.warnish')`
);
assert.equal(results.warnsBeforeChoosing, true);

// Submitting without choosing is refused client-side and sends nothing.
await evaluate(`(function(){
  document.querySelector('[data-field="chapter"]').value = 'Ch 1';
  document.querySelector('[data-field="chapter"]').dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelector('[data-field="date"]').value = '2026-11-01';
  document.querySelector('[data-field="date"]').dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelector('[data-act="propose"]').click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 300));
results.blockedToast = await evaluate(`(document.querySelector('.toast')||{}).textContent || ''`);
assert.match(results.blockedToast, /BJU|proofs/i);
assert.equal(lastPropose, null, 'nothing must be sent to the server without a format');

// Choose proofs, submit, and the choice reaches the API.
await evaluate(`document.querySelector('[data-act="geomode"][data-v="proofs"]').click()`);
results.pressed = await evaluate(
  `document.querySelector('[data-act="geomode"][data-v="proofs"]').getAttribute('aria-pressed')`
);
assert.equal(results.pressed, 'true');

await evaluate(`document.querySelector('[data-act="propose"]').click()`);
await new Promise((r) => setTimeout(r, 500));
assert.ok(lastPropose, 'the proposal should have been sent');
assert.equal(lastPropose.geometryMode, 'proofs');
assert.equal(lastPropose.course, 'Geometry (4th ed.)');

// Switching to Science hides the field entirely.
await evaluate(`document.querySelector('[data-act="subject"][data-v="Science"]').click()`);
results.hiddenForScience = await evaluate(`!!document.querySelector('.geo-modes')`);
assert.equal(results.hiddenForScience, false);

// Back to Math, then typing a non-Geometry course hides it again.
await evaluate(`document.querySelector('[data-act="subject"][data-v="Math"]').click()`);
assert.equal(await evaluate(`!!document.querySelector('.geo-modes')`), true);
await evaluate(`(function(){
  const el = document.querySelector('[data-field="course"]');
  el.value = 'Algebra 1 (3rd ed.)';
  el.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
})()`);
results.hiddenForAlgebra = await evaluate(`!!document.querySelector('.geo-modes')`);
assert.equal(results.hiddenForAlgebra, false);

/* A screenshot when asked, so the field can be looked at rather than only
   asserted about. */
if (process.env.SHOT) {
  await evaluate(`(function(){
    const el = document.querySelector('[data-field="course"]');
    el.value = 'Geometry (4th ed.)';
    el.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-act="geomode"][data-v="proofs"]').click();
    return true;
  })()`);
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, S);
  fs.writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'));
}

ws.close();
chrome.kill();
server.close();
fs.rmSync(userDir, { recursive: true, force: true });

console.log('browser-geometry-mode: all assertions passed');
console.log(JSON.stringify(results, null, 2));
