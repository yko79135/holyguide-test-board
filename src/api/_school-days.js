import CAL from './_school-calendar.js';

/* Is there school on this date?
 *
 * Mr. Ko's standing instruction (2026-10-14): approve every test request,
 * except one booked on a day with no school — that one is declined at once
 * and the student is emailed to pick a school day.
 *
 * The calendar is a copy of the Holga Parent Portal's terms and closure days
 * (_school-calendar.js). A day has no school when it is a Saturday or a
 * Sunday, a listed closure, or a vacation day between terms. A date beyond
 * the last term the copy knows is judged on weekends and listed closures
 * only — the board would rather approve one it cannot judge than decline a
 * real school day. */

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* Returns why there is no school on `date` (YYYY-MM-DD), or null if there is. */
export function noSchoolReason(date, cal = CAL) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  if (dow === 0 || dow === 6) return 'it is a ' + WEEKDAY[dow];

  const labels = (cal.closures || {})[date];
  if (labels && labels.length) return 'the school is closed (' + labels.join(', ') + ')';

  const terms = cal.terms || [];
  if (terms.length) {
    const first = terms.reduce((a, t) => (t.start < a ? t.start : a), terms[0].start);
    const last = terms.reduce((a, t) => (t.end > a ? t.end : a), terms[0].end);
    const inTerm = terms.some((t) => date >= t.start && date <= t.end);
    if (!inTerm && date >= first && date <= last) return 'it falls in the school vacation';
  }
  return null;
}
