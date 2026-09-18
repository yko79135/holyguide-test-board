import assert from 'node:assert/strict';
import {checkWorkerHealth} from '../src/api/_worker-health.mjs';
let stale=false, claimed=false, sends=0, state;
const sql=async(strings,...args)=>{
 const q=strings.join('?');
 if(q.includes('select checked_at'))return stale?[{checked_at:'2026-09-18T04:00:00Z'}]:[];
 if(q.includes('insert into')){if(claimed)return [];claimed=true;return [{}];}
 if(q.includes('update ubuntu_worker_alerts')){state=args[0];return [];}
 throw Error('unexpected SQL');
};
const sendEmail=async()=>{sends++;return true;};
assert.equal((await checkWorkerHealth({sql,sendEmail,recipient:'teacher@example.invalid'})).state,'healthy_or_not_started');
assert.equal(sends,0);stale=true;
assert.equal((await checkWorkerHealth({sql,sendEmail,recipient:'teacher@example.invalid'})).state,'sent');
assert.equal(state,'sent');
assert.equal((await checkWorkerHealth({sql,sendEmail,recipient:'teacher@example.invalid'})).state,'already_reported');
assert.equal(sends,1);claimed=false;
assert.equal((await checkWorkerHealth({sql,sendEmail:async()=>false,recipient:'teacher@example.invalid'})).state,'uncertain');
assert.equal(state,'uncertain');
console.log('Cloud monitor: healthy silence, single incident alert, permanent uncertain result passed.');
