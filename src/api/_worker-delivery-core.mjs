import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {CUTOFF_UTC} from './_worker-snapshot-core.mjs';

export const PEOPLE = new Set(['zion','yoonchan','hojin','yoonji']);
const FIELDS = ['id','student_id','subject','course','chapter','test_date','test_period','test_time','status','created_at','decided_at'];
// Match Python policy.digest's sorted, unicode-preserving JSON contract.
export function revision(row) {
  const text = '{' + [...FIELDS].sort().map(k => JSON.stringify(k)+': '+JSON.stringify(row[k] ?? null)).join(', ') + '}';
  return createHash('sha256').update(text).digest('hex');
}
export function eligible(row, epoch, now = new Date()) {
  if (!row || !PEOPLE.has(row.student_id) || row.status !== 'approved') return false;
  if (!/^G?(7|8|9|10|11|12)(E|K)?$/.test(String(row.grade))) return false;
  const created = new Date(row.created_at), approved = new Date(row.decided_at);
  if (!(created >= new Date(epoch) && approved >= created && approved <= now && created >= new Date(CUTOFF_UTC))) return false;
  const today = new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
  const day = new Date(row.test_date+'T00:00:00Z');
  const distance = (day-new Date(today+'T00:00:00Z'))/86400000;
  return Number.isInteger(distance) && distance>=0 && distance<=7;
}

export function createDeliveryHandler({db,send,secret=()=>process.env.BUILD_SECRET||'',now=()=>new Date()}) {
  return async (req,res) => {
    res.setHeader('cache-control','no-store');
    const a=Buffer.from(secret()), b=Buffer.from(String(req.headers?.['x-build-secret']||''));
    if (!a.length || a.length!==b.length || !timingSafeEqual(a,b)) return send(res,401,{error:'Worker authentication required.'});
    if (!['GET','POST'].includes(req.method)) return send(res,405,{error:'Use GET or POST.'});
    try {
      let body=req.body||{};
      if(typeof body==='string') body=JSON.parse(body);
      if(req.method==='POST' && body.action==='initialize') {
        const epoch=await db.initialize();
        return send(res,200,{ok:true,eligible_from:epoch,send_enabled:false});
      }
      const epoch=await db.epoch();
      if(!epoch) return send(res,503,{error:'Delivery authority not initialized.'});
      if(req.method==='POST' && body.action==='heartbeat') {
        if(!['evaluated','blocked','needs_attention'].includes(body.status))
          return send(res,400,{error:'Invalid health state.'});
        await db.heartbeat(body.status);
        return send(res,200,{ok:true});
      }
      if(req.method==='GET') {
        const records=await db.history();
        if(records.length>500) return send(res,503,{error:'History exceeds bounded capacity.'});
        return send(res,200,{authority:'existing_sender',complete:true,verified_at:now().toISOString(),
          scoped_from:epoch,records,ownership:'ubuntu_new_reservations_only'});
      }
      if(body.action==='claim') {
        if(typeof body.id!=='string' || typeof body.email!=='string' || !/^[a-f0-9]{64}$/.test(body.material_sha256||''))
          return send(res,400,{error:'Invalid claim.'});
        const row=await db.proposal(body.id);
        if(!eligible(row,epoch,now()) || row.email!==body.email || revision(row)!==body.revision)
          return send(res,409,{state:'blocked',reason:'changed_or_ineligible'});
        // The database rechecks the entire proposal version and mailbox atomically.
        const token=randomUUID();
        const claimed=await db.claim(row,body,token,epoch);
        if(!claimed) return send(res,409,{state:'blocked',reason:'already_claimed_or_changed'});
        return send(res,200,{state:'claimed',token,reservation_id:body.id});
      }
      if(body.action==='finish') {
        if(!['sent','uncertain'].includes(body.state) || typeof body.token!=='string' || typeof body.id!=='string')
          return send(res,400,{error:'Invalid outcome.'});
        const result=await db.finish(body);
        return send(res,result?200:409,result?{state:result}:{error:'Claim mismatch.'});
      }
      return send(res,400,{error:'Unknown action.'});
    } catch {
      return send(res,503,{error:'Delivery coordination unavailable.'});
    }
  };
}
