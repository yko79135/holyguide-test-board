import SENDS from './_sent-elsewhere-data.js';

/* Tests whose material Ezra already emailed outside the board.

   Source of truth: OneDrive School Duty/sent.json (Ezra is its only
   writer). Vercel cannot read OneDrive, so tools/sync-sent-elsewhere.py
   copies the board-reservation entries into _sent-elsewhere-data.js and
   pushes; each push redeploys. Only reservation id, kind, date and sender
   are copied — no names, addresses or student keys (the repo is public). */

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export function sentElsewhere(reservationId, kind, sends = SENDS) {
  return (Array.isArray(sends) ? sends : [])
    .find((e) => e.reservation === reservationId && norm(e.kind) === norm(kind)) || null;
}
