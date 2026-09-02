import { neon } from '@neondatabase/serverless';

export const CONFIG = {
  databaseUrl:
    process.env.DATABASE_URL,
  googleClientId:
    process.env.GOOGLE_CLIENT_ID ||
    '1075055122385-au7hh0hhloisa59d3hmcp8q1fsuberii.apps.googleusercontent.com',
  teacherEmail: (process.env.TEACHER_EMAIL || 'yko79135@gmail.com').toLowerCase(),
};

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
           to_char(test_date,'YYYY-MM-DD') as test_date, note, status, teacher_note,
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
