import pg from 'pg';

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

/* Supabase is reached over an ordinary Postgres connection, so the driver
   is node-postgres rather than Neon's HTTP client.

   Only this block changed in the move. Every call site in the codebase is
   a tagged template — sql`select ... ${id}` — and `sql` below keeps that
   exact contract: a tagged template in, a plain array of rows out. The two
   drivers share pg-types, so every column still arrives parsed the way it
   always was (date and timestamptz as Date, time and int8 as string, jsonb
   already inflated); nothing downstream had to learn a new shape.

   Supabase's direct host, db.<ref>.supabase.co, has no A record — it is
   IPv6-only — so the connection string must be a *pooler* URI. In
   transaction mode the pooler cannot carry named prepared statements, and
   pool.query() with text and values never creates one, so the shim is
   already in the shape that mode requires.

   TLS is always on. The chain is verified only when DATABASE_CA_CERT is
   supplied, because the pooler's CA is not in Node's default trust store
   on every platform; without it the connection is encrypted but the
   server's certificate is not checked. */
const ca = (process.env.DATABASE_CA_CERT || '').replace(/\\n/g, '\n').trim();

/* sslmode=disable is honoured so the board can be pointed at a Postgres on
   localhost during development. Nothing reachable over a network should
   ever use it, and Supabase refuses the connection without TLS anyway. */
const sslDisabled = /[?&]sslmode=disable\b/.test(CONFIG.databaseUrl || '');

const pool = new pg.Pool({
  connectionString: CONFIG.databaseUrl,
  ssl: sslDisabled ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  /* One connection per warm function instance. A serverless process that
     is frozen mid-request must not leave a fistful of sockets held open
     against the pooler's connection limit. */
  max: 1,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
});

/* A pool emits 'error' for a connection dropped while idle. Unhandled, that
   event is an uncaught exception that takes the whole function down between
   requests — the pool itself simply discards the socket and carries on. */
pool.on('error', (err) => {
  console.error('pg pool: idle client error —', err.message);
});

export function sql(strings, ...values) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += '$' + (i + 1) + strings[i + 1];
  return pool.query(text, values).then((r) => r.rows);
}

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
  /* The newest build request per proposal, so the board can say "being
     made" instead of showing an approved test with nothing under it. A
     student watching an empty row has no way to tell the difference
     between work in progress and work nobody started. */
  const builds = await sql`
    select distinct on (proposal_id)
           proposal_id, status, reason,
           to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD') as asked_on
      from build_requests
     order by proposal_id, created_at desc`;
  const byProposal = Object.fromEntries(builds.map((b) => [b.proposal_id, b]));
  for (const p of proposals) p.build = byProposal[p.id] || null;

  /* The last morning check, so the board can say when it last ran rather
     than leaving him to guess from an empty inbox. */
  const runs = await sql`
    select to_char(ran_at at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI') as ran_at,
           via, sent, missing, failed, skipped
      from delivery_runs order by ran_at desc limit 1`;

  const settings = await sql`select key, value from settings`;
  const s = Object.fromEntries(settings.map((r) => [r.key, r.value]));
  return { students, proposals, leadDays: Number(s.lead_days || 7), lastRun: runs[0] || null };
}

export function fail(res, err) {
  send(res, err.status || 500, { error: err.message || 'Something went wrong.' });
}

export function seoulToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
