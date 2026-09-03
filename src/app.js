(function(){
  "use strict";
  var root = document.getElementById("root");
  var cfg = null, token = null, data = null, busy = false;
  var authError = "", toastMsg = "", toastTimer = null;
  var draft = {}, editRoster = false, gsiReady = false;

  function ss(k,v){ try{ return v===undefined ? sessionStorage.getItem(k) : sessionStorage.setItem(k,v); }catch(e){ return null; } }
  function ssDel(k){ try{ sessionStorage.removeItem(k); }catch(e){} }

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g,function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function addDays(iso,n){ var d=new Date(iso+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
  function diffDays(a,b){ return Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000); }
  function fmtDate(iso){ return iso ? new Intl.DateTimeFormat("en-US",{timeZone:"UTC",weekday:"short",month:"short",day:"numeric"}).format(new Date(iso+"T00:00:00Z")) : "—"; }
  function fmtLong(iso){ return iso ? new Intl.DateTimeFormat("en-US",{timeZone:"UTC",month:"long",day:"numeric",year:"numeric"}).format(new Date(iso+"T00:00:00Z")) : "—"; }
  function dayWord(n){
    if(n===0) return "today";
    if(n===1) return "tomorrow";
    if(n<0) return Math.abs(n)+(Math.abs(n)===1?" day ago":" days ago");
    return "in "+n+" days";
  }
  function today(){ return (data && data.today) || new Date().toISOString().slice(0,10); }
  function lead(){ return (data && data.leadDays) || 7; }
  function studentById(id){
    var list = (data && data.students) || [];
    for(var i=0;i<list.length;i++){ if(list[i].id===id) return list[i]; }
    return {id:id,name:id};
  }
  function sendOn(p){ return addDays(p.test_date, -lead()); }
  function periodByN(n){
    var list = (cfg && cfg.periods) || [];
    for(var i=0;i<list.length;i++){ if(list[i].n === n) return list[i]; }
    return null;
  }
  function whenText(p){
    var per = periodByN(p.test_period);
    if(per) return per.n+"교시 · "+per.start+"–"+per.end;
    if(p.test_time) return p.test_time;
    return "";
  }
  function toast(m){
    toastMsg = m;
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastMsg=""; render(); }, 4500);
    render();
  }

  function api(path, payload){
    busy = true; render();
    return fetch(path, {
      method: payload ? "POST" : "GET",
      headers: Object.assign({"authorization":"Bearer "+token}, payload ? {"content-type":"application/json"} : {}),
      body: payload ? JSON.stringify(payload) : undefined
    }).then(function(r){
      return r.json().catch(function(){ return {error:"The server sent something unreadable."}; })
        .then(function(j){ return {ok:r.ok, status:r.status, json:j}; });
    }).then(function(res){
      busy = false;
      if(res.ok){ data = res.json; return res.json; }
      if(res.status === 401){ token = null; ssDel("tdb.token"); authError = res.json.error || "Sign in again."; data = null; render(); return null; }
      if(res.status === 403 && !data){ token = null; ssDel("tdb.token"); authError = res.json.error || "You are not on this roster."; render(); return null; }
      toast(res.json.error || "That did not go through.");
      return null;
    }).catch(function(){
      busy = false;
      toast("No connection. Check your network and try again.");
      return null;
    });
  }

  function onCredential(resp){
    token = resp.credential;
    ss("tdb.token", token);
    authError = "";
    api("/api/board").then(function(d){ if(d) render(); });
  }
  function mountGoogleButton(){
    if(!window.google || !window.google.accounts || !cfg || !cfg.configured) return;
    var el = document.getElementById("gsi");
    if(!el || el.dataset.mounted) return;
    el.dataset.mounted = "1";
    if(!gsiReady){
      window.google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: onCredential,
        auto_select: true,
        cancel_on_tap_outside: false
      });
      gsiReady = true;
    }
    window.google.accounts.id.renderButton(el, { theme:"outline", size:"large", shape:"pill", text:"signin_with", width:280 });
    /* One Tap is deliberately NOT prompted here. Under Chrome’s FedCM both
       One Tap and the rendered button go through navigator.credentials.get(),
       and only one such request may be outstanding — One Tap won the race and
       every click on the button was silently swallowed. The button alone is
       the sign-in path now. */
    // window.google.accounts.id.prompt();
  }
  function signOut(){
    token = null; data = null; authError = ""; gsiReady = false;
    ssDel("tdb.token");
    try{ window.google.accounts.id.disableAutoSelect(); }catch(e){}
    render();
  }

  function pillFor(p){
    if(p.status === "pending") return '<span class="pill wait">Waiting for Mr. Ko</span>';
    if(p.status === "declined") return '<span class="pill no">Not approved</span>';
    if(p.sent_at) return '<span class="pill sent">Materials sent</span>';
    return '<span class="pill ok">Approved</span>';
  }
  function timeline(p){
    var t = today(), s = sendOn(p);
    var toSend = diffDays(t,s), toTest = diffDays(t,p.test_date);
    var sent = !!p.sent_at, pre = Math.max(0,toSend);
    var preFlex = Math.max(0.12, Math.min(3, pre/lead()));
    var right = sent ? "Sent "+fmtDate(p.sent_at)
      : (toSend>0 ? "Study guide + practice test go out "+fmtDate(s) : "Materials due now");
    return '<div class="tl"><div class="tl-track">'
      + (pre>0 ? '<div class="tl-seg before" style="flex:'+preFlex.toFixed(2)+'"></div>' : '')
      + '<div class="tl-dot '+(sent||toSend<=0?"done":"send")+'"></div>'
      + '<div class="tl-seg window" style="flex:1"></div><div class="tl-dot test"></div></div>'
      + '<div class="tl-labels"><span><b>'+esc(right)+'</b></span>'
      + '<span>Test '+esc(fmtDate(p.test_date))+' · '+esc(dayWord(toTest))+'</span></div></div>';
  }
  function rowHTML(p, opts){
    opts = opts || {};
    var s = studentById(p.student_id);
    var cls = p.status === "approved" ? "approved" : p.status === "pending" ? "pending" : "declined";
    var h = '<div class="row '+cls+'"><div class="row-top">';
    h += '<span class="row-title">'+esc(p.subject)+' · '+esc(p.chapter)+'</span>';
    var when = whenText(p);
    h += '<span class="row-date">'+esc(fmtLong(p.test_date))+(when ? ' · '+esc(when) : '')+'</span>';
    h += '<span class="row-who">'+(opts.showWho ? esc(s.name)+' — ' : '')+esc(p.course)+'</span>';
    h += '<span class="spacer"></span>'+pillFor(p)+'</div>';
    if(p.note) h += '<p class="row-note">“'+esc(p.note)+'”</p>';
    if(p.teacher_note) h += '<p class="row-note">Mr. Ko: '+esc(p.teacher_note)+'</p>';
    if(p.status === "approved") h += timeline(p);
    var files = p.files || [];
    if(p.status === "approved" && files.length){
      h += '<p class="hint">Sent: '+files.map(function(f){
        return f.link ? '<a href="'+esc(f.link)+'" target="_blank" rel="noopener">'+esc(f.name)+'</a>' : esc(f.name);
      }).join(" · ")+'</p>';
    }
    if(p.status === "approved" && cfg && cfg.calendar && !p.calendar_event_id
       && data.me && data.me.role === "teacher"){
      h += '<p class="hint warnish">This one did not make it onto your Google Calendar. Approving it again will retry.</p>';
    }
    if(p.status === "approved" && p.delivery_status === "missing"){
      h += '<p class="hint warnish">No study guide or practice test in Drive yet — Mr. Ko has been emailed.</p>';
    }
    if(opts.actions) h += opts.actions(p);
    return h + '</div>';
  }
  function nextUpHTML(){
    var t = today();
    var up = data.proposals.filter(function(p){ return p.status==="approved" && p.test_date >= t; });
    if(!up.length) return "";
    var p = up[0], s = studentById(p.student_id);
    return '<div class="nextup"><span class="big">'+esc(s.name)+' · '+esc(p.subject)+' '+esc(p.chapter)+'</span>'
      + '<span class="meta">'+esc(fmtLong(p.test_date))
      + (whenText(p) ? ' · '+esc(whenText(p)) : '')+' · materials '
      + esc(p.sent_at ? "sent "+fmtDate(p.sent_at) : "go out "+fmtDate(sendOn(p)))+'</span>'
      + '<span class="days">'+esc(dayWord(diffDays(t,p.test_date)))+'</span></div>';
  }

  function studentView(){
    var me = data.me, s = studentById(me.studentId), t = today();
    var mine = data.proposals.filter(function(p){ return p.student_id === me.studentId; });
    var pend = mine.filter(function(p){ return p.status==="pending"; });
    var appr = mine.filter(function(p){ return p.status==="approved" && p.test_date >= t; });
    var past = mine.filter(function(p){ return p.status==="declined" || (p.status!=="pending" && p.test_date < t); }).reverse();

    var subj = draft.subject || "Math";
    var course = draft.course != null ? draft.course : (subj==="Math" ? s.math_course : s.science_course) || "";
    var early = draft.date && diffDays(t, draft.date) < lead()+1;

    var h = '<section class="card card-pad">';
    h += '<div class="sec-head"><h2>Propose a test date</h2><span class="eyebrow">Step 1 of 2</span></div><div class="form">';
    h += '<div><label>Subject</label><div class="seg">'
      + ["Math","Science"].map(function(x){ return '<button type="button" data-act="subject" data-v="'+x+'" aria-pressed="'+(subj===x)+'">'+x+'</button>'; }).join("")
      + '</div></div>';
    h += '<div class="f-row"><div><label for="f-course">Course</label>'
      + '<input id="f-course" type="text" data-field="course" value="'+esc(course)+'" placeholder="e.g. Geometry (4th ed.)"></div>'
      + '<div><label for="f-chapter">Chapter</label>'
      + '<input id="f-chapter" type="text" data-field="chapter" value="'+esc(draft.chapter||"")+'" placeholder="e.g. Ch 8"></div></div>';
    var slot = draft.slot == null ? "" : String(draft.slot);
    var periods = (cfg && cfg.periods) || [];
    h += '<div class="f-row"><div><label for="f-date">Test date</label>'
      + '<input id="f-date" type="date" data-field="date" min="'+addDays(t,1)+'" value="'+esc(draft.date||"")+'">'
      + (draft.date ? '<p class="hint'+(early?" warnish":"")+'">'+(early
          ? 'That is less than '+(lead()+1)+' days away — your study guide would arrive late.'
          : 'Study guide + practice test would reach you '+esc(fmtDate(addDays(draft.date,-lead())))+'.')+'</p>' : '')
      + '</div><div><label for="f-slot">Class period</label>'
      + '<select id="f-slot" data-field="slot">'
      + '<option value=""'+(slot===""?' selected':'')+'>Not sure yet</option>'
      + periods.map(function(x){
          return '<option value="'+x.n+'"'+(slot===String(x.n)?' selected':'')+'>'
            + x.n+'교시 · '+x.start+'–'+x.end+'</option>';
        }).join("")
      + '<option value="other"'+(slot==="other"?' selected':'')+'>Other time…</option>'
      + '</select>'
      + (slot==="other"
          ? '<input type="time" data-field="time" value="'+esc(draft.time||"")+'" style="margin-top:8px">'
          : '<p class="hint">Mr. Ko puts approved tests straight onto his calendar, so a period helps.</p>')
      + '</div></div>';
    h += '<div><label for="f-note">Anything Mr. Ko should know</label>'
      + '<input id="f-note" type="text" data-field="note" value="'+esc(draft.note||"")+'" placeholder="Optional"></div>';
    h += '<div class="actions"><button class="btn" data-act="propose"'+(busy?" disabled":"")+'>Send to Mr. Ko</button>'
      + '<span class="hint">He approves it before anything is scheduled.</span></div></div></section>';

    function acts(p){
      return p.status === "pending"
        ? '<div class="actions"><button class="btn ghost sm" data-act="withdraw" data-id="'+p.id+'">Withdraw</button></div>'
        : "";
    }
    h += '<section><div class="sec-head"><h2>Waiting on Mr. Ko</h2><span class="count">'+pend.length+'</span></div>'
      + (pend.length ? '<div class="rows">'+pend.map(function(p){ return rowHTML(p,{actions:acts}); }).join("")+'</div>' : '<p class="empty">Nothing pending.</p>')
      + '</section>';
    h += '<section><div class="sec-head"><h2>Your approved tests</h2><span class="count">'+appr.length+'</span></div>'
      + (appr.length ? '<div class="rows">'+appr.map(function(p){ return rowHTML(p,{}); }).join("")+'</div>' : '<p class="empty">No test dates approved yet.</p>')
      + '</section>';
    if(past.length){
      h += '<section><div class="sec-head"><h2>Earlier</h2><span class="count">'+past.length+'</span></div>'
        + '<div class="rows">'+past.map(function(p){ return rowHTML(p,{}); }).join("")+'</div></section>';
    }
    return h;
  }

  function teacherView(){
    var t = today();
    var pend = data.proposals.filter(function(p){ return p.status==="pending"; });
    var appr = data.proposals.filter(function(p){ return p.status==="approved" && p.test_date >= t; });
    var past = data.proposals.filter(function(p){ return p.status==="declined" || (p.status==="approved" && p.test_date < t); }).reverse();

    function acts(p){
      if(p.status === "pending"){
        return '<div class="actions">'
          + '<input type="text" data-field="tnote-'+p.id+'" placeholder="Note back to '+esc(studentById(p.student_id).name)+' (optional)" style="flex:1;min-width:180px">'
          + '<button class="btn sm" data-act="approve" data-id="'+p.id+'"'+(busy?" disabled":"")+'>Approve</button>'
          + '<button class="btn danger sm" data-act="decline" data-id="'+p.id+'"'+(busy?" disabled":"")+'>Decline</button></div>';
      }
      if(p.status === "approved" && !p.sent_at){
        return '<div class="actions"><button class="btn ghost sm" data-act="reopen" data-id="'+p.id+'">Move back to pending</button></div>';
      }
      return "";
    }

    var h = '<section><div class="sec-head"><h2>Awaiting your approval</h2><span class="count">'+pend.length+'</span></div>'
      + (pend.length ? '<div class="rows">'+pend.map(function(p){ return rowHTML(p,{showWho:true,actions:acts}); }).join("")+'</div>' : '<p class="empty">Nothing to approve right now.</p>')
      + '</section>';
    h += '<section><div class="sec-head"><h2>Approved schedule</h2><span class="count">'+appr.length+' upcoming</span></div>'
      + (appr.length ? '<div class="rows">'+appr.map(function(p){ return rowHTML(p,{showWho:true,actions:acts}); }).join("")+'</div>' : '<p class="empty">No approved tests on the calendar.</p>')
      + '</section>';

    h += '<section class="card card-pad"><div class="sec-head"><h2>Who gets the email</h2>'
      + '<button class="btn ghost sm" data-act="toggle-roster">'+(editRoster?"Done":"Edit")+'</button></div><div class="roster">';
    data.students.forEach(function(s){
      h += '<div class="rost-row"><div class="rost-name">'+esc(s.name)+'<span>'+esc(s.full_name||"")+' · '+esc(s.grade||"")+'</span></div><div>';
      if(editRoster){
        h += '<div class="f-row"><div><label>Email</label><input type="email" data-field="email-'+s.id+'" value="'+esc(s.email||"")+'" placeholder="student@gmail.com"></div>'
          + '<div><label>Math course</label><input type="text" data-field="math-'+s.id+'" value="'+esc(s.math_course||"")+'"></div></div>'
          + '<div class="f-row"><div><label>Science course</label><input type="text" data-field="sci-'+s.id+'" value="'+esc(s.science_course||"")+'"></div>'
          + '<div style="align-self:end"><button class="btn sm" data-act="save-student" data-id="'+s.id+'"'+(busy?" disabled":"")+'>Save '+esc(s.name)+'</button></div></div>'
          + '<p class="hint">This is the address they sign in with and the address materials go to.</p>';
      } else {
        h += '<p>'+(s.email
              ? esc(s.email)+' '+(s.email_confirmed
                  ? '<span class="verified">signed in</span>'
                  : '<span class="unverified">has not signed in yet</span>')
              : '<span class="unverified">no address yet — add one or they cannot sign in</span>')+'</p>'
          + '<p class="hint">Math: '+esc(s.math_course||"—")+' · Science: '+esc(s.science_course||"—")+'</p>';
      }
      h += '</div></div>';
    });
    h += '</div></section>';

    h += '<section class="note"><b>What happens after you approve</b><ol>'
      + '<li>The test goes onto your Google Calendar straight away.</li>'
      + '<li>Every morning a scheduled task reads this board and looks for approved tests '+lead()+' days out.</li>'
      + '<li>It looks in Drive for that chapter’s study guide, practice test and answer key.</li>'
      + '<li>If they exist, it emails them to the student — attached and linked — with you on CC, and marks the test <em>Materials sent</em> here.</li>'
      + '<li>If they don’t exist yet, it emails you instead and keeps checking each day.</li>'
      + '</ol></section>';

    if(past.length){
      h += '<section><div class="sec-head"><h2>Past &amp; declined</h2><span class="count">'+past.length+'</span></div>'
        + '<div class="rows">'+past.map(function(p){ return rowHTML(p,{showWho:true}); }).join("")+'</div></section>';
    }
    return h;
  }

  function gate(inner){
    root.innerHTML = '<div class="gate"><div class="gate-card">'+inner+'</div></div>';
  }

  function render(){
    if(!cfg){ gate('<h1>Test Date Board</h1><p>Loading…</p>'); return; }

    if(!cfg.configured){
      gate('<h1>Almost there</h1>'
        + '<p>The board is deployed, but Google sign-in has not been switched on yet. Until it is, nobody can get in.</p>'
        + '<div class="note"><b>To finish setup</b><ol>'
        + '<li>Create an OAuth client ID at <code>console.cloud.google.com/apis/credentials</code> (type: Web application).</li>'
        + '<li>Add <code>'+esc(location.origin)+'</code> as an Authorized JavaScript origin.</li>'
        + '<li>Send the client ID back to Claude, or set it as <code>GOOGLE_CLIENT_ID</code> in the Vercel project.</li>'
        + '</ol></div>');
      return;
    }

    if(!token || !data){
      gate('<h1>Test Date Board</h1>'
        + '<p>Math and science test dates for Mr. Ko’s students. Sign in with the Google account on your class roster.</p>'
        + (authError ? '<p class="gate-err">'+esc(authError)+'</p>' : '')
        + '<div class="gate-signin" id="gsi"></div>');
      mountGoogleButton();
      return;
    }

    var me = data.me;
    var names = data.students.map(function(s){ return esc(s.name); }).join("</b> and <b>");
    var h = '<div class="wrap"><header class="mast"><div><h1>Test Date Board</h1>'
      + '<p class="sub">Math &amp; science tests for <b>'+names+'</b>. '
      + 'Propose a date, Mr. Ko approves it, study materials arrive '+lead()+' days before.</p></div>'
      + '<div class="idbox"><div><div class="name">'+esc(me.role==="teacher"?"Mr. Ko":studentById(me.studentId).name)+'</div>'
      + '<div class="role">'+esc(me.email)+'</div></div>'
      + '<button class="btn ghost sm" data-act="signout">Sign out</button></div></header>';

    h += '<div class="stack">'+nextUpHTML()+(me.role==="teacher"?teacherView():studentView())+'</div>';
    h += '<footer><span>'+(busy?"Saving…":"Saved automatically")+'</span>'
      + '<span>Today is '+esc(fmtLong(today()))+' (Seoul)</span></footer></div>';
    if(toastMsg) h += '<div class="toast" role="status">'+esc(toastMsg)+'</div>';
    root.innerHTML = h;
  }

  function val(f){
    var el = document.querySelector('[data-field="'+f+'"]');
    return el ? el.value.trim() : "";
  }

  document.addEventListener("input", function(e){
    var f = e.target.getAttribute && e.target.getAttribute("data-field");
    if(!f) return;
    if(f==="course"||f==="chapter"||f==="note"||f==="time") draft[f] = e.target.value;
    if(f==="date"){ draft.date = e.target.value; render(); }
    if(f==="slot"){ draft.slot = e.target.value; if(draft.slot !== "other") draft.time = ""; render(); }
  });

  document.addEventListener("click", function(e){
    var btn = e.target.closest ? e.target.closest("[data-act]") : null;
    if(!btn) return;
    var act = btn.getAttribute("data-act"), id = btn.getAttribute("data-id"), v = btn.getAttribute("data-v");

    if(act === "signout") return signOut();
    if(act === "toggle-roster"){ editRoster = !editRoster; return render(); }
    if(act === "subject"){
      var s = studentById(data.me.studentId);
      draft.subject = v;
      draft.course = (v === "Math" ? s.math_course : s.science_course) || "";
      return render();
    }
    if(act === "propose"){
      var payload = {
        subject: draft.subject || "Math",
        course: draft.course != null ? draft.course : val("course"),
        chapter: draft.chapter != null ? draft.chapter : val("chapter"),
        date: draft.date || val("date"),
        note: draft.note != null ? draft.note : val("note"),
        period: (draft.slot && draft.slot !== "other") ? Number(draft.slot) : null,
        time: draft.slot === "other" ? (draft.time || val("time")) : ""
      };
      if(!String(payload.chapter).trim()) return toast("Which chapter is the test on?");
      if(!payload.date) return toast("Pick a test date first.");
      if(draft.slot === "other" && !payload.time) return toast("Type the time, or pick a class period.");
      return api("/api/propose", payload).then(function(d){ if(d){ draft = {}; toast("Sent to Mr. Ko."); } });
    }
    if(act === "withdraw") return api("/api/withdraw", {id:id}).then(function(d){ if(d) toast("Withdrawn."); });
    if(act === "approve" || act === "decline"){
      return api("/api/decide", {id:id, decision:act, teacherNote:val("tnote-"+id)})
        .then(function(d){ if(d) toast(act === "approve" ? "Approved." : "Declined."); });
    }
    if(act === "reopen") return api("/api/decide", {id:id, decision:"reopen"});
    if(act === "save-student"){
      return api("/api/roster", {id:id, email:val("email-"+id), math:val("math-"+id), science:val("sci-"+id)})
        .then(function(d){ if(d) toast("Roster updated."); });
    }
  });

  var poll = setInterval(function(){
    if(window.google && window.google.accounts){ clearInterval(poll); mountGoogleButton(); }
  }, 200);
  setTimeout(function(){ clearInterval(poll); }, 15000);

  fetch("/api/config").then(function(r){ return r.json(); }).then(function(c){
    cfg = c;
    token = ss("tdb.token");
    if(token && cfg.configured){
      api("/api/board").then(function(){ render(); });
    } else {
      render();
    }
  }).catch(function(){
    cfg = {configured:false, googleClientId:""};
    render();
  });
})();
