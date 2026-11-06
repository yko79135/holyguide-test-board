/* How a test's time is chosen. Pure — no database, no env — so the
   server, the tests and the calendar all read it the same way.

   A test sits one period, or two back-to-back periods (Mr. Ko,
   2026-11-06). Lunch sits between 4 and 5, so 4–5 is not a pair. */
export const LUNCH_AFTER = 4;

export function canPair(n, periods) {
  return n !== LUNCH_AFTER && periods.some((x) => x.n === n + 1);
}

/* Reads {period, periodEnd, time} from a request body. A period is
   required; "Other time" (a typed HH:MM) is the only way round it.
   Returns {error} or {period, periodEnd, time}. */
export function readSlot(b, periods) {
  const period = b.period == null || b.period === '' ? null : Number(b.period);
  const periodEnd = b.periodEnd == null || b.periodEnd === '' ? null : Number(b.periodEnd);
  const time = String(b.time || '').trim();
  if (period !== null) {
    const match = periods.find((x) => x.n === period);
    if (!match) return { error: 'That is not one of the school periods.' };
    if (periodEnd !== null && periodEnd !== period) {
      if (periodEnd !== period + 1 || !canPair(period, periods)) {
        return { error: 'Two periods must be back to back, and not across lunch.' };
      }
      return { period, periodEnd, time: match.start };
    }
    return { period, periodEnd: null, time: match.start };
  }
  if (!time) return { error: 'Pick the class period for the test.' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'That time does not look right — use HH:MM.' };
  return { period: null, periodEnd: null, time };
}

/* Start and end clock times for a row, or null when it has no period. */
export function periodSpan(p, periods) {
  const first = periods.find((x) => x.n === p.test_period);
  if (!first) return null;
  const last = (p.test_period_end != null && periods.find((x) => x.n === p.test_period_end)) || first;
  const label = last === first ? first.n + '교시' : first.n + '–' + last.n + '교시';
  return { start: first.start, end: last.end, label };
}
