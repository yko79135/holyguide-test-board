import crypto from 'node:crypto';
import { CONFIG, PERIODS } from './_lib.js';

/* ------------------------------------------------------------------ *
 * Both integrations are best-effort. A calendar or email failure must
 * never turn a successful approval into an error for Mr. Ko — the row
 * in Postgres is the source of truth, Google and Resend are echoes.
 * Every export here resolves; none of them throw.
 * ------------------------------------------------------------------ */

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function calendarConfigured() {
  return Boolean(CONFIG.saEmail && CONFIG.saKey && CONFIG.calendarId);
}
export function emailConfigured() {
  return Boolean(CONFIG.resendKey && CONFIG.notifyEmail);
}

/* Service-account JWT -> OAuth access token. No googleapis dependency:
   that library is tens of megabytes for what is one signature and one
   POST, and cold starts on a hobby plan are already the slow part. */
export async function googleAccessToken(scope = 'https://www.googleapis.com/auth/calendar.events') {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: CONFIG.saEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claim);
  const assertion = header + '.' + claim + '.' + b64url(signer.sign(CONFIG.saKey));

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const raw = await r.text();
  let j = {};
  try { j = JSON.parse(raw); } catch { /* keep raw for the message below */ }
  if (!r.ok || !j.access_token) {
    throw new Error(
      'Google refused the service account (' + r.status + '): ' +
      (j.error_description || j.error || raw.slice(0, 200))
    );
  }
  return j.access_token;
}

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + mins;
  return String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}
function nextDay(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* An untimed proposal becomes an all-day event rather than a fake 9am
   one, so the calendar tells the truth about what is actually known. */
function eventTimes(p) {
  const period = PERIODS.find((x) => x.n === p.test_period);
  if (period) {
    return {
      start: { dateTime: p.test_date + 'T' + period.start + ':00', timeZone: CONFIG.timeZone },
      end: { dateTime: p.test_date + 'T' + period.end + ':00', timeZone: CONFIG.timeZone },
    };
  }
  if (p.test_time) {
    return {
      start: { dateTime: p.test_date + 'T' + p.test_time + ':00', timeZone: CONFIG.timeZone },
      end: { dateTime: p.test_date + 'T' + addMinutes(p.test_time, 40) + ':00', timeZone: CONFIG.timeZone },
    };
  }
  return { start: { date: p.test_date }, end: { date: nextDay(p.test_date) } };
}

export function whenLabel(p) {
  const period = PERIODS.find((x) => x.n === p.test_period);
  if (period) return p.test_date + ' · ' + period.n + '교시 (' + period.start + '–' + period.end + ')';
  if (p.test_time) return p.test_date + ' · ' + p.test_time;
  return p.test_date + ' · time not set';
}

/* Returns the new event id, or null if it could not be created. */
export async function createCalendarEvent(p, studentName) {
  if (!calendarConfigured()) return null;
  try {
    const token = await googleAccessToken();
    const body = {
      summary: studentName + ' — ' + p.subject + ' ' + p.chapter + ' test',
      description: [
        p.course && 'Course: ' + p.course,
        'Student: ' + studentName,
        p.note && 'Student note: ' + p.note,
        p.teacher_note && 'Your note: ' + p.teacher_note,
        'Approved on the Test Date Board.',
      ].filter(Boolean).join('\n'),
      source: { title: 'Test Date Board', url: CONFIG.appUrl },
      ...eventTimes(p),
    };
    const r = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/' +
        encodeURIComponent(CONFIG.calendarId) + '/events',
      {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const raw = await r.text();
    let j = {};
    try { j = JSON.parse(raw); } catch { /* keep raw for the message below */ }
    if (!r.ok) throw new Error(j.error?.message || 'calendar insert ' + r.status + ': ' + raw.slice(0, 200));
    return j.id || null;
  } catch (err) {
    console.error('[calendar] could not create event for ' + p.id + ':', err.message);
    return null;
  }
}

export async function deleteCalendarEvent(eventId) {
  if (!eventId || !calendarConfigured()) return;
  try {
    const token = await googleAccessToken();
    const r = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/' +
        encodeURIComponent(CONFIG.calendarId) + '/events/' + encodeURIComponent(eventId),
      { method: 'DELETE', headers: { authorization: 'Bearer ' + token } }
    );
    /* 410 means it is already gone, which is the state we wanted. */
    if (!r.ok && r.status !== 404 && r.status !== 410) {
      throw new Error('calendar delete returned ' + r.status);
    }
  } catch (err) {
    console.error('[calendar] could not delete event ' + eventId + ':', err.message);
  }
}

export async function emailTeacher(subject, lines) {
  if (!emailConfigured()) return;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + CONFIG.resendKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: CONFIG.notifyFrom,
        to: [CONFIG.notifyEmail],
        subject,
        text: lines.filter(Boolean).join('\n'),
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.message || 'resend returned ' + r.status);
    }
  } catch (err) {
    console.error('[email] could not send "' + subject + '":', err.message);
  }
}

/* One send, with attachments. Resend wants base64 content and caps the
   whole message at 40 MB; a study guide is a few hundred kilobytes, so the
   cap is never the constraint — the verified sending domain is. Unlike
   emailTeacher this reports whether Resend actually accepted the message,
   because the caller marks a test as delivered on the strength of it, and
   a row that says 'sent' when nothing was sent is worse than no row. */
export async function sendEmail({ to, cc, subject, lines, attachments }) {
  if (!emailConfigured() || !to) return false;
  try {
    const payload = {
      from: CONFIG.notifyFrom,
      to: Array.isArray(to) ? to : [to],
      subject,
      text: (lines || []).filter(Boolean).join('\n'),
    };
    if (cc && cc.length) payload.cc = Array.isArray(cc) ? cc : [cc];
    if (attachments && attachments.length) {
      payload.attachments = attachments.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content).toString('base64'),
      }));
    }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + CONFIG.resendKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.message || 'resend returned ' + r.status);
    }
    return true;
  } catch (err) {
    console.error('[email] could not send "' + subject + '":', err.message);
    return false;
  }
}
