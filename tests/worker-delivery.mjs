import assert from 'node:assert/strict';
import {createDeliveryHandler,eligible,revision} from '../src/api/_worker-delivery-core.mjs';
const now=new Date('2026-09-18T04:00:00Z'),epoch='2026-09-18T03:00:00Z';
const row={id:'new-1',student_id:'zion',subject:'Science',course:'Life Science',chapter:'Ch 17',test_date:'2026-09-21',test_period:1,test_time:null,status:'approved',created_at:'2026-09-18T03:01:00Z',decided_at:'2026-09-18T03:02:00Z',email:'fixture@example.invalid',grade:'G7'};
let claimCount=0,states=new Map();
const db={initialize:async()=>epoch,epoch:async()=>epoch,heartbeat:async()=>{},history:async()=>[...states].map(([reservation_id,x])=>({reservation_id,state:x.state})),proposal:async()=>row,
claim:async(r,b,token)=>{if(states.has(r.id))return false;states.set(r.id,{state:'claimed',token});claimCount++;return true;},
finish:async b=>{const s=states.get(b.id);if(!s||s.token!==b.token)return null;if(s.state==='claimed')s.state=b.state;return s.state;}};
const handler=createDeliveryHandler({db,now:()=>now,secret:()=> 'fixture-secret',send:(res,status,body)=>Object.assign(res,{status,body})});
async function call(method,body={},secret='fixture-secret'){const res={headers:{},setHeader(k,v){this.headers[k]=v;}};await handler({method,body,headers:{'x-build-secret':secret}},res);assert.equal(res.headers['cache-control'],'no-store');return res;}
assert.equal((await call('GET',{},'bad')).status,401);
assert.equal((await call('DELETE')).status,405);
assert.equal((await call('POST',{action:'heartbeat',status:'evaluated'})).status,200);
assert.equal((await call('POST',{action:'heartbeat',status:'anything'})).status,400);
assert.equal(eligible({...row,created_at:'2026-09-18T02:20:00Z'},epoch,now),false);
assert.equal(eligible({...row,student_id:'excluded'},epoch,now),false);
assert.equal(eligible({...row,grade:'G6'},epoch,now),false);
const body={action:'claim',id:row.id,email:row.email,revision:revision(row),material_sha256:'a'.repeat(64)};
assert.equal((await call('POST',{...body,revision:'changed'})).status,409);
assert.equal((await call('POST',{...body,email:'changed@example.invalid'})).status,409);
const attempts=await Promise.all([call('POST',body),call('POST',body)]);
assert.equal(attempts.filter(x=>x.status===200).length,1);assert.equal(claimCount,1);
const token=attempts.find(x=>x.status===200).body.token;
assert.equal((await call('POST',{action:'finish',id:row.id,token:'wrong',state:'sent'})).status,409);
assert.equal((await call('POST',{action:'finish',id:row.id,token,state:'uncertain'})).body.state,'uncertain');
assert.equal((await call('POST',body)).status,409);
assert.equal((await call('POST',{action:'finish',id:row.id,token,state:'sent'})).body.state,'uncertain');
assert.equal((await call('GET')).body.records[0].state,'uncertain');
console.log('Delivery coordination: auth, cutoff, recipient/grade, changed approvals, competing claims, uncertainty latch and idempotent outcomes passed.');
