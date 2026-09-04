import { neon } from '@neondatabase/serverless';

/* A service-account PEM reaches this process through a form field, and
   that field mangles it in three reliable ways: the value arrives still
   wrapped in the quotes it was copied with, its newlines arrive as the
   two characters \n, or they are lost entirely and the whole key becomes
   one line. All three make node:crypto throw
   'error:1E08010C:DECODER routines::unsupported' — which surfaces as a
   calendar event that silently never appears. Normalising here is kinder
   than asking a person to paste 1,700 characters perfectly. */
function normalizePem(raw) {
  let k = String(raw || '').trim();
  if (!k) return '';
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  k = k.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();

  /* The armour is the part people lose. In the JSON key file the value is
     easy to select from MII… onward, leaving the BEGIN/END lines behind —
     what remains is a perfectly good PKCS#8 body that OpenSSL will not
     look at, and the only symptom is a calendar event that never appears.
     Re-wrap whatever we were given; hand back anything unrecognisable
     untouched so a real error still surfaces as itself. */
  let label = 'PRIVATE KEY';
  let body = k;
  const m = k.match(/^-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----$/);
  if (m) {
    label = m[1];
    body = m[2];
  } else if (!/^[A-Za-z0-9+/=\s]+$/.test(k)) {
    return k;
  }

  body = body.replace(/\s+/g, '');
  const wrapped = (body.match(/.{1,64}/g) || []).join('\n');
  return '-----BEGIN ' + label + '-----\n' + wrapped + '\n-----END ' + label + '-----\n';
}

export const CONFIG = {
  databaseUrl:
    process.env.DATABASE_URL,
  googleClientId:
    process.env.GOOGLE_CLIENT_ID ||
    '1075055122385-au7hh0hhloisa59d3hmcp8q1fsuberii.apps.googleusercontent.com',
  teacherEmail: (process.env.TEACHER_EMAIL || 'yko79135@gmail.com').toLowerCase(),
  timeZone: 'Asia/Seoul',
  appUrl: process.env.APP_URL || 'https://holyguide-test-board.vercel.app',

  // Google Calendar, via a service account that the target calendar has
  // been shared with. Absent => approvals simply skip the calendar.
  saEmail: process.env.GOOGLE_SA_EMAIL || '',
  saKey: normalizePem(process.env.GOOGLE_SA_PRIVATE_KEY),
  calendarId: process.env.CALENDAR_ID || '',

  // Email, via Resend. Absent => proposals simply do not notify.
  // Gmail, via an app password. Present => the board sends as Mr. Ko
  // himself and can write to students without a verified domain. Google
  // shows an app password in four spaced groups; people paste it that way,
  // and SMTP rejects the spaces, so drop them here rather than blame them.
  gmailUser: (process.env.GMAIL_USER || process.env.TEACHER_EMAIL || 'yko79135@gmail.com').toLowerCase(),
  gmailAppPassword: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),

  resendKey: process.env.RESEND_API_KEY || '',
  notifyFrom: process.env.NOTIFY_FROM || 'Test Date Board <onboarding@resend.dev>',
  notifyEmail: (process.env.NOTIFY_EMAIL || process.env.TEACHER_EMAIL || 'yko79135@gmail.com').toLowerCase(),
};

// The school day. Shared by the server (event length) and the client
// (the picker), so the two can never drift apart.
export const PERIODS = [
  { n: 1, start: '09:00', end: '09:40' },
  { n: 2, start: '09:45', end: '10:25' },
  { n: 3, start: '10:30', end: '11:10' },
  { n: 4, start: '11:15', end: '11:55' },
  { n: 5, start: '13:05', end: '13:45' },
  { n: 6, start: '13:50', end: '14:30' },
  { n: 7, start: '14:35', end: '15:15' },
  { n: 8, start: '15:20', end: '16:00' },
];

export const sql = neon(CONFIG.databaseUrl);

export function send(res, code, obj) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.status(code).end(JSON.stringify(obj));
}

export function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

export async function authenticate(req) {
  if (!CONFIG.googleClientId) {
    const e = new Error('Google sign-in is not configured yet.');
    e.status = 503;
    throw e;
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    const e = new Error('Sign in to continue.');
    e.status = 401;
    throw e;
  }

  let info;
  try {
    const r = await fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token)
    );
    if (!r.ok) throw new Error('rejected');
    info = await r.json();
  } catch {
    const e = new Error('That sign-in could not be verified. Sign in again.');
    e.status = 401;
    throw e;
  }

  const audOk = info.aud === CONFIG.googleClientId;
  const issOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  const fresh = Number(info.exp) * 1000 > Date.now();
  const verified = info.email_verified === true || info.email_verified === 'true';
  if (!audOk || !issOk || !fresh || !verified || !info.email) {
    const e = new Error('That sign-in could not be verified. Sign in again.');
    e.status = 401;
    throw e;
  }

  const email = String(info.email).toLowerCase();
  const name = info.name || info.given_name || email;

  if (email === CONFIG.teacherEmail) return { role: 'teacher', email, name };

  const rows = await sql`select id, name from students where lower(email) = ${email} limit 1`;
  if (!rows.length) {
    const e = new Error(
      'This board is only for Mr. Ko and his students. ' + email + ' is not on the roster.'
    );
    e.status = 403;
    throw e;
  }

  await sql`update students set email_confirmed = true where id = ${rows[0].id} and email_confirmed = false`;

  return { role: 'student', email, name, studentId: rows[0].id, studentName: rows[0].name };
}

export async function loadBoard() {
  const students = await sql`
    select id, name, full_name, grade, email, email_confirmed, math_course, science_course
    from students order by sort_order, name`;
  const proposals = await sql`
    select id, student_id, subject, course, chapter,
           to_char(test_date,'YYYY-MM-DD') as test_date,
           test_period, to_char(test_time,'HH24:MI') as test_time, calendar_event_id,
           note, status, teacher_note,
           created_at, decided_at, delivery_status,
           to_char(sent_at,'YYYY-MM-DD') as sent_at, files,
           to_char(last_check,'YYYY-MM-DD') as last_check
    from proposals order by test_date`;
  const settings = await sql`select key, value from settings`;
  const s = Object.fromEntries(settings.map((r) => [r.key, r.value]));
  return { students, proposals, leadDays: Number(s.lead_days || 7) };
}

export function fail(res, err) {
  send(res, err.status || 500, { error: err.message || 'Something went wrong.' });
}

export function seoulToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
