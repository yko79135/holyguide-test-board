import { sql, send, fail, body, CONFIG } from './_lib.js';
import { sendEmail } from './_integrations.js';

/* ------------------------------------------------------------------ *
 * The desk where the board and Mr. Ko's desktop hand work to one
 * another.
 *
 * The board runs in the cloud and cannot reach his ASUS — it sits on a
 * home connection and is asleep half the day. So nothing is ever pushed
 * to it: the desktop asks what is waiting, builds it, and reports back.
 *
 * Note what this deliberately does NOT touch. The desktop's job ends at
 * putting the finished document in Drive; the morning run already sends
 * whatever is in Drive. Generation joins the loop without a single
 * change to the part that writes to a child.
 * ------------------------------------------------------------------ */

/* Both directions carry the same shared secret. Without it this is an
   endpoint that lists students, their courses and their test dates, so
   a missing secret closes the desk rather than opening it to everyone. */
function authorize(req) {
  const secret = process.env.BUILD_SECRET || '';
  const given = String(req.headers['x-build-secret'] || '');
  if (!secret || !given || given !== secret) {
    const e = new Error('This endpoint needs the build secret.');
    e.status = 401;
    throw e;
  }
}

export default async function handler(req, res) {
  try {
    authorize(req);

    if (req.method === 'GET') {
      /* Handing the work out and marking it taken is one statement, so
         two polls cannot both walk away with the same chapter. A claim
         goes stale after thirty minutes: a desktop that goes to sleep
         mid-build must not park a request forever, because a request
         nobody ever answers is a student with no study guide and no
         sign that anything is wrong. */
      const rows = await sql`
        update build_requests
           set status = 'claimed', claimed_at = now()
         where status = 'pending'
            or (status = 'claimed' and claimed_at < now() - interval '30 minutes')
        returning id, proposal_id, student_id, subject, course, chapter, kind,
                  to_char(test_date,'YYYY-MM-DD') as test_date`;
      return send(res, 200, { requests: rows });
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' });

    const b = body(req);
    const id = String(b.id || '');
    const status = String(b.status || '');
    if (!['done', 'refused'].includes(status)) {
      return send(res, 400, { error: "status must be 'done' or 'refused'." });
    }

    const rows = await sql`select * from build_requests where id = ${id} limit 1`;
    if (!rows.length) return send(res, 404, { error: 'No such build request.' });
    const request = rows[0];

    if (status === 'done') {
      const files = Array.isArray(b.files) ? b.files : [];
      await sql`
        update build_requests
           set status = 'done', answered_at = now(), claimed_at = null,
               files = ${JSON.stringify(files)}::jsonb
         where id = ${id}`;
      return send(res, 200, { ok: true, id, status: 'done', files: files.length });
    }

    /* A refusal is a first-class answer, not a failure — "Geometry 4th
       edition is not in the catalogue" is exactly the thing he wanted to
       hear early rather than on the morning the guide was due. It is
       also the only outcome nothing else would surface: a document that
       never appears in Drive looks identical to one nobody asked for. */
    const reason = String(b.reason || '').trim().slice(0, 600);
    await sql`
      update build_requests
         set status = 'refused', answered_at = now(), claimed_at = null,
             reason = ${reason}
       where id = ${id}`;

    try {
      await sendEmail({
        to: CONFIG.notifyEmail,
        subject: 'Could not build the ' + request.kind + ' for ' +
                 request.chapter + ' (' + request.course + ')',
        lines: [
          'The desktop could not build this one, so nothing is in Drive for it.',
          '',
          'Chapter: ' + request.chapter,
          'Course: ' + (request.course || '(not recorded)'),
          'Needed: ' + request.kind,
          'Test date: ' + (request.test_date || '(not recorded)'),
          '',
          'It said: ' + (reason || '(no reason given)'),
          '',
          'The board will send it the moment the document exists in Drive.',
          CONFIG.appUrl,
        ],
      });
    } catch {
      /* Best-effort, like every other export here. The row is the record;
         the email is an echo, and a refusal that failed to email is still
         a refusal a person can see on the board. */
    }

    return send(res, 200, { ok: true, id, status: 'refused' });
  } catch (err) {
    fail(res, err);
  }
}
