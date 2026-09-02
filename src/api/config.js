import { CONFIG, PERIODS, send } from './_lib.js';
import { calendarConfigured, emailConfigured } from './_integrations.js';

export default function handler(req, res) {
  send(res, 200, {
    googleClientId: CONFIG.googleClientId,
    configured: Boolean(CONFIG.googleClientId),
    periods: PERIODS,
    calendar: calendarConfigured(),
    email: emailConfigured(),
  });
}
