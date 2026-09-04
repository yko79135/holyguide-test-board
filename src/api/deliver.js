import { authenticate, sql, send, fail, CONFIG, seoulToday } from './_lib.js';
import { sendEmail, whenLabel, emailConfigured } from './_integrations.js';
import { leadDays } from './_approve.js';
import { materialKind, findMaterial, fetchMaterial } from './_materials.js';

/* ------------------------------------------------------------------ *
 * The morning run.
 *
 * Finds every approved test inside the lead-time window that has not had
 * its materials delivered, looks the chapter's document up in Drive, and
 * emails it to the student with Mr. Ko on CC. A test approved eight days
 * out waits a day; a test approved three days out goes on the next run —
 * "a week before, or immediately if it is sooner" is the same rule said
 * once.
 *
 * Two invariants worth keeping:
 *
 *   A row is marked delivered only when Resend actually accepted the
 *   message. Marking on intent would quietly strand a student.
 *
 *   A missing document is reported to Mr. Ko once a day, not once a run,
 *   which is what last_check is for.
 * ------------------------------------------------------------------ */

/* Never open. Vercel Cron presents CRON_SECRET; Mr. Ko can also trigger a
   run himself with his own board sign-in. Anything else is refused —
   this endpoint emails children and lists the roster. */
async function authorize(req) {
  const secret = process.env.CRON_SECRET || '';
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (secret && given && given === secret) return { via: 'cron' };

  const me = await authenticate(req);
  if (me.role !== 'teacher') {
    const e = new Error('Only Mr. Ko can run the materials check.');
    e.status = 403;
    throw e;
  }
  return { via: 'teacher' };
}

export default async function handler(req, res) {
  try {
    const who = await authorize(req);
    const dryRun = 'dry' in (req.query || {});
    const today = seoulToday();
    const lead = await leadDays();
    const out = {
      today, leadDays: lead, via: who.via, dryRun,
      emailConfigured: emailConfigured(),
      sent: [], missing: [], failed: [],
    };

    const rows = await sql`
      select p.id, p.subject, p.course, p.chapter,
             to_char(p.test_date,'YYYY-MM-DD') as test_date,
             p.test_period, to_char(p.test_time,'HH24:MI') as test_time,
             to_char(p.last_check,'YYYY-MM-DD') as last_check,
             s.name as student_name, s.email as student_email,
             s.math_course, s.science_course
        from proposals p join students s on s.id = p.student_id
       where p.status = 'approved'
         and p.delivery_status <> 'sent'
         and p.test_date >= ${today}::date
         and p.test_date <= ${today}::date + ${lead}
       order by p.test_date`;

    for (const row of rows) {
      const kind = materialKind(row.subject);
      const course =
        row.course || (row.subject === 'Math' ? row.math_course : row.science_course);
      const wanted = kind + ' — ' + course + ' ' + row.chapter;

      let file = null;
      try {
        file = await findMaterial({ chapter: row.chapter, kind, course });
      } catch (err) {
        out.failed.push({ id: row.id, student: row.student_name, error: err.message });
        console.error('[deliver] drive lookup failed for ' + row.id + ':', err.message);
        continue;
      }

      if (!file) {
        out.missing.push({ id: row.id, student: row.student_name, wanted });
        if (!dryRun) {
          const firstLookToday = row.last_check !== today;
          await sql`update proposals set last_check = ${today}::date where id = ${row.id}`;
          if (firstLookToday) {
            await sendEmail({
              to: CONFIG.notifyEmail,
              subject: 'No ' + kind + ' yet for ' + row.student_name + '’s ' + row.chapter + ' test',
              lines: [
                row.student_name + '’s test is on ' + whenLabel(row) + ' and there is nothing to send.',
                '',
                'Looking for: ' + wanted,
                'Nothing in Drive matches that chapter and course.',
                '',
                'The board will look again tomorrow morning and send it the moment it exists.',
                CONFIG.appUrl,
              ],
            });
          }
        }
        continue;
      }

      if (!row.student_email) {
        out.failed.push({ id: row.id, student: row.student_name, error: 'no address on the roster' });
        continue;
      }

      if (dryRun) {
        out.sent.push({ id: row.id, student: row.student_name, file: file.name, dryRun: true });
        continue;
      }

      try {
        const attachment = await fetchMaterial(file);
        const ok = await sendEmail({
          to: row.student_email,
          cc: [CONFIG.notifyEmail],
          subject: row.subject + ' ' + row.chapter + ' test — your ' + kind.toLowerCase(),
          lines: [
            row.student_name + ',',
            '',
            'Your ' + row.subject + ' ' + row.chapter + ' test is on ' + whenLabel(row) + '.',
            'Your ' + kind.toLowerCase() + ' is attached.',
            '',
            'Mr. Ko',
          ],
          attachments: [attachment],
        });

        if (!ok) {
          out.failed.push({
            id: row.id, student: row.student_name,
            error: emailConfigured() ? 'Resend refused the message' : 'email is not configured yet',
          });
          await sql`update proposals set last_check = ${today}::date where id = ${row.id}`;
          continue;
        }

        await sql`
          update proposals
             set delivery_status = 'sent',
                 sent_at = ${today}::date,
                 last_check = ${today}::date,
                 files = ${JSON.stringify([{ id: file.id, name: file.name, kind }])}::jsonb
           where id = ${row.id}`;
        out.sent.push({ id: row.id, student: row.student_name, file: file.name });
      } catch (err) {
        out.failed.push({ id: row.id, student: row.student_name, error: err.message });
        console.error('[deliver] could not deliver ' + row.id + ':', err.message);
      }
    }

    send(res, 200, out);
  } catch (err) {
    fail(res, err);
  }
}
