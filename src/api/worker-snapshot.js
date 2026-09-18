import { sql, send } from './_lib.js';
import { createHandler } from './_worker-snapshot-core.mjs';

export default createHandler({ sql, send });
