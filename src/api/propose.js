import { authenticate, sql, loadBoard, send, fail, body, seoulToday, PERIODS, CONFIG } from './_lib.js';
import { emailTeacher, whenLabel } from './_integrations.js';
import { autoApproveEnabled, leadDays, holdReasons, approveProposal, autoApprovedEmail } from './_approve.js';
import { createHandler } from './_propose-core.mjs';

export default createHandler({
  authenticate, sql, loadBoard, send, fail, body, seoulToday, PERIODS, CONFIG,
  emailTeacher, whenLabel,
  autoApproveEnabled, leadDays, holdReasons, approveProposal, autoApprovedEmail,
});
