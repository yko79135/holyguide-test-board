import BLOCKS from './_musical-blocks.js';

/* Is this student in a musical rehearsal during this test slot?
 *
 * Mr. Ko (2026-11-13): "block students from booking slots that you know a
 * musical practice is scheduled for that student." A slot is blocked when a
 * rehearsal that takes the student's grade overlaps it by 10 minutes or
 * more — the same rule his live schedule uses to mark a class "수업 없음
 * (뮤지컬)". Pure: the server and the page both call it.
 *
 * grade: the roster's grade text ("G8", "G7E", "G12"). No grade, no block —
 * the board would rather let a booking through than refuse one it cannot
 * judge. A typed "Other time" is treated as a 40-minute test. */

const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

export function gradeNumber(grade) {
  const m = String(grade || '').match(/(\d{1,2})/);
  return m ? Number(m[1]) : null;
}

export function slotWindow({ period, periodEnd, time }, periods) {
  if (period != null) {
    const a = periods.find((x) => x.n === Number(period));
    const b = (periodEnd != null && periods.find((x) => x.n === Number(periodEnd))) || a;
    return a ? [toMin(a.start), toMin(b.end)] : null;
  }
  if (time && /^\d{2}:\d{2}$/.test(time)) return [toMin(time), toMin(time) + 40];
  return null;
}

export function musicalClash(date, slot, grade, periods, blocks = BLOCKS) {
  const g = gradeNumber(grade);
  const win = slotWindow(slot, periods);
  if (g == null || !win || !date) return null;
  return blocks.find((r) => r.d === date && r.g.includes(g) &&
    Math.min(win[1], toMin(r.e)) - Math.max(win[0], toMin(r.s)) >= 10) || null;
}

export function blocksFrom(today, blocks = BLOCKS) {
  return blocks.filter((r) => r.d >= today);
}
