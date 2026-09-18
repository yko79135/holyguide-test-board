import {sql,send} from './_lib.js';
import {createDeliveryHandler} from './_worker-delivery-core.mjs';

const db={
  async initialize(){
    await sql`create table if not exists ubuntu_delivery_authority
      (id integer primary key check(id=1), eligible_from timestamptz not null default now())`;
    await sql`create table if not exists ubuntu_deliveries
      (reservation_id text primary key, student_id text not null, token text not null,
       state text not null check(state in ('claimed','sent','uncertain')),
       revision text not null, material_sha256 text not null, email text not null,
       claimed_at timestamptz not null default now(), finished_at timestamptz)`;
    await sql`insert into ubuntu_delivery_authority(id) values(1) on conflict do nothing`;
    return this.epoch();
  },
  async epoch(){
    const rows=await sql`select eligible_from from ubuntu_delivery_authority where id=1`;
    return rows[0]?.eligible_from||null;
  },
  async history(){
    return sql`select reservation_id,state from ubuntu_deliveries order by claimed_at limit 501`;
  },
  async proposal(id){
    const rows=await sql`select p.id,p.student_id,p.subject,p.course,p.chapter,
      to_char(p.test_date,'YYYY-MM-DD') as test_date,p.test_period,
      to_char(p.test_time,'HH24:MI') as test_time,p.status,p.created_at,p.decided_at,
      md5(to_jsonb(p)::text) as row_version,s.email,s.grade,s.math_course,s.science_course
      from proposals p join students s on s.id=p.student_id where p.id=${id} limit 1`;
    return rows[0]||null;
  },
  async claim(row,body,token,epoch){
    const rows=await sql`insert into ubuntu_deliveries
      (reservation_id,student_id,token,state,revision,material_sha256,email)
      select p.id,p.student_id,${token},'claimed',${body.revision},${body.material_sha256},s.email
      from proposals p join students s on s.id=p.student_id
      where p.id=${row.id} and md5(to_jsonb(p)::text)=${row.row_version}
        and s.email=${body.email} and s.grade=${row.grade}
        and s.math_course is not distinct from ${row.math_course}
        and s.science_course is not distinct from ${row.science_course}
        and p.status='approved' and p.created_at>=${epoch}::timestamptz
        and p.test_date >= (now() at time zone 'Asia/Seoul')::date
        and p.test_date <= (now() at time zone 'Asia/Seoul')::date + 7
      on conflict(reservation_id) do nothing returning reservation_id`;
    return rows.length===1;
  },
  async finish(body){
    const rows=await sql`update ubuntu_deliveries set state=${body.state},finished_at=now()
      where reservation_id=${body.id} and token=${body.token} and state='claimed' returning state`;
    if(!rows.length){
      const old=await sql`select state from ubuntu_deliveries where reservation_id=${body.id} and token=${body.token}`;
      return old[0]?.state||null;
    }
    // Ledger is authoritative even if this display update fails. Never retry mail.
    if(rows[0].state==='sent') {
      await sql`update proposals set delivery_status='sent',claimed_at=null,
        sent_at=(now() at time zone 'Asia/Seoul')::date,
        last_check=(now() at time zone 'Asia/Seoul')::date
        where id=${body.id} and status='approved'`;
    }
    return rows[0].state;
  }
};
export default createDeliveryHandler({db,send});
