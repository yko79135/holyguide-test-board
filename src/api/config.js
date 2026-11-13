import { CONFIG, PERIODS, send } from './_lib.js';
import { calendarConfigured, emailConfigured } from './_integrations.js';
import { blocksFrom } from './_musical.js';

export default function handler(req, res) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  send(res, 200, {
    googleClientId: CONFIG.googleClientId,
    configured: Boolean(CONFIG.googleClientId),
    periods: PERIODS,
    // Rehearsal slots (date, time, grades only) so the form can grey them out.
    musical: blocksFrom(today),
    calendar: calendarConfigured(),
    email: emailConfigured(),
  });
}
