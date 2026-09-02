import { CONFIG, send } from './_lib.js';

export default function handler(req, res) {
  send(res, 200, {
    googleClientId: CONFIG.googleClientId,
    configured: Boolean(CONFIG.googleClientId),
  });
}
