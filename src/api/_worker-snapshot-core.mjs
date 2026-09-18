import { timingSafeEqual } from 'node:crypto';

// Frozen at migration preparation. Neither caller input nor an old re-approval
// can lower this boundary and pull historical reservations into the new worker.
export const CUTOFF_UTC = '2026-09-18T02:16:51Z';

export function createHandler({ sql, send, secret = () => process.env.BUILD_SECRET || '', now = () => new Date() }) {
  return async function handler(req, res) {
    const expected = Buffer.from(secret());
    const supplied = Buffer.from(String(req.headers?.['x-build-secret'] || ''));
    if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      return send(res, 401, { error: 'Worker authentication required.' });
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      return send(res, 405, { error: 'Use GET or HEAD.' });
    }
    try {
      if (req.method === 'HEAD') {
        await sql`select 1 as ok`;
        res.setHeader('cache-control', 'no-store');
        return res.status(200).end();
      }
      const rows = await sql`
        select p.id, p.student_id, p.subject, p.course, p.chapter,
               to_char(p.test_date, 'YYYY-MM-DD') as test_date,
               p.test_period, to_char(p.test_time, 'HH24:MI') as test_time,
               p.status, p.created_at, p.decided_at, p.delivery_status, p.sent_at,
               json_build_object('id', s.id, 'name', s.name, 'full_name', s.full_name,
                 'grade', s.grade, 'email', s.email, 'email_confirmed', s.email_confirmed,
                 'math_course', s.math_course, 'science_course', s.science_course) as student
          from proposals p join students s on s.id = p.student_id
         where p.status = 'approved'
           and p.created_at >= ${CUTOFF_UTC}::timestamptz
           and p.decided_at >= ${CUTOFF_UTC}::timestamptz
           and p.test_date >= (now() at time zone 'Asia/Seoul')::date
         order by p.test_date, p.id
         limit 501`;
      if (rows.length > 500) return send(res, 503, { error: 'Snapshot exceeds bounded worker capacity.' });
      const settings = await sql`select value from settings where key = 'lead_days' limit 1`;
      const lead = settings.length ? Number(settings[0].value) : 7;
      if (!Number.isInteger(lead) || lead < 0 || lead > 365) {
        return send(res, 503, { error: 'Invalid lead_days configuration.' });
      }
      const students = new Map();
      const proposals = rows.map(({ student, ...proposal }) => {
        students.set(student.id, student);
        return proposal;
      });
      return send(res, 200, {
        schema_version: 1, verified_at: now().toISOString(), cutoff_utc: CUTOFF_UTC,
        lead_days: lead, proposals, students: [...students.values()],
      });
    } catch {
      // Do not expose DB credentials, SQL, row values, or provider errors.
      return send(res, 503, { error: 'Worker snapshot unavailable.' });
    }
  };
}
