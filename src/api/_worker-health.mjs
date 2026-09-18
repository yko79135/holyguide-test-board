// Runs in the existing cloud cron, independently of Samsung and ASUS.
export async function checkWorkerHealth({sql,sendEmail,recipient}) {
  const rows=await sql`select checked_at from ubuntu_worker_health
    where id=1 and checked_at < now()-interval '30 minutes'`;
  if(!rows.length) return {state:'healthy_or_not_started'};
  const stamp=rows[0].checked_at;
  const claimed=await sql`insert into ubuntu_worker_alerts(heartbeat_at,state)
    values(${stamp},'claimed') on conflict do nothing returning heartbeat_at`;
  if(!claimed.length) return {state:'already_reported'};
  let state='uncertain';
  try {
    const ok=await sendEmail({to:recipient,subject:'Samsung school automation has stopped checking in',
      lines:['Samsung has not reported a schoolwork check for over 30 minutes.',
        'The computer, network, or checking service may be unavailable.',
        'Student delivery and preparation checks may be delayed. Please check Samsung.',
        'This is an automated status notice from the cloud board.']});
    if(ok) state='sent';
  } finally {
    await sql`update ubuntu_worker_alerts set state=${state} where heartbeat_at=${stamp}`;
  }
  return {state};
}
