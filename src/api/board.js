import { authenticate, loadBoard, send, fail, seoulToday } from './_lib.js';

export default async function handler(req, res) {
  try {
    const me = await authenticate(req);
    const board = await loadBoard();
    send(res, 200, { me, today: seoulToday(), ...board });
  } catch (err) {
    fail(res, err);
  }
}
