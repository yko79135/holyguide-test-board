# Test Date Board — state of play

Last updated **2026-09-04**. Keep this current. It exists because the previous
handoff notes lived only in a chat session, went stale, and then sent a later
session chasing three problems that had already been fixed.

**Mark every claim with how it was proven.** The stale notes said the sibling
repo's virtualenv was broken and its git history had diverged. Both were false —
they were inferences from reading files by hand, written down as if observed.
A session that actually ran the commands found neither was true.

---

## What runs today

| Piece | State | Proven by |
|---|---|---|
| Sign-in (Google) | working | a real sign-in, after the FedCM fix below |
| Board read/write | working | `/api/health` → `db: true` |
| Calendar on approve | working | event `cdb8qk7idgfd75pvsihrq7683g`, seen on the calendar |
| Auto-approval | **on** | rules unit-tested; no live proposal yet |
| Materials delivery | built, **never sent** | dry run matches the right file; no real send |
| Daily cron 07:00 KST | registered | Vercel Cron Jobs page; **has never fired** |

`/api/health` is the fastest way to check all of it. It reports `db`,
`saKeyParses`, `sender`, and per-credential booleans with error codes, and no
secrets. Three of the four bugs below were found with one request to it.

---

## Four bugs, and what each one taught

**`DATABASE_URL` was wrong for two days and looked fine.** Every route
authenticates *before* touching Postgres, so an unauthenticated probe returned a
healthy `401` while every signed-in request 500'd. Nobody could use the board.
→ *A health check must exercise the dependency, not the guard in front of it.*
That is why `/api/health` runs `select 1`.

**Sign-in was swallowed by our own One Tap call.** `app.js` rendered the Google
button *and* called `google.accounts.id.prompt()`. Under Chrome's FedCM only one
`navigator.credentials.get()` may be outstanding, so One Tap won the race and
every click on the button did nothing — `NotAllowedError: Only one
navigator.credentials.get request may be outstanding`. The `prompt()` call is
gone. → *Don't render the button and prompt One Tap.*

**The service-account key arrived without its `-----BEGIN-----` lines.** Only
symptom: `ERR_OSSL_UNSUPPORTED`, thrown inside a best-effort path designed never
to throw, so the calendar event simply never appeared. `_lib.js:normalizePem`
now restores the armour, strips stray quotes, and re-wraps a body that lost its
line breaks. → *Normalise credentials that arrive through a form field.*

**`date + unknown` in the delivery query.** The lead-time was passed as an
untyped bind parameter, so Postgres could not resolve the operator — and it only
threw once a test was actually *in range*, i.e. exactly when it mattered. The
window is computed in JavaScript now. → *A bug that only fires on the non-empty
path is invisible until it is urgent.*

---

## Drive: search does not see what the service account can read

`findMaterial` originally used `name contains 'ch01'`. It returned **nothing**,
while the same query as the owner returned the file, and the service account
demonstrably had reader on it.

A service account's search corpus does not reliably include files it reaches
only through a shared folder. The file was readable by id and invisible to
search — indistinguishable, from the outside, from the file not existing.

`listChapterFiles` now **walks down** from the shared root
(`1CodcVoCA6slGkxFf06UHU5C13PZwXVw4`, "BJU TROVE AGENT"), three levels, which
uses only access we know we have. Slower, correct. `?dry=1` reports what Drive
handed back so this is never ambiguous again.

---

## Matching

Drive holds two naming conventions and one comparison covers both: lowercase,
strip every non-alphanumeric character, and compare
`chapter + kind + course`.

```
Ch01 Study Guide - Chemistry (5th ed.)        -> ch01studyguidechemistry5thed
Ch13_Practice_Test__Algebra_1_3rd_ed_.pdf     -> ch13practicetestalgebra13rded
```

Chapters are zero-padded to two digits, so `Ch.01`, `Ch 1`, `Chapter 1` and `1`
all resolve to `ch01`. Science → Study Guide, math → Practice Test. **Answer keys
are never sent to a student.**

The match is exact on purpose: a near miss sends a student the wrong chapter,
which is worse than being told the file is missing.

**Known gap.** The sibling agent emits one artifact per *assessment group*, so a
Ch8–9 assessment produces `Ch08-09 Study Guide - …`. The board cannot key that
yet. It needs to parse a range and match any chapter inside it. Not yet written —
nothing produces such a file today.

---

## Sending

`mailer()` picks Gmail when `GMAIL_APP_PASSWORD` is set, else Resend, else
nothing. Gmail is preferred: it needs no domain, and mail comes from the address
students recognise so replies reach a real inbox.

Resend's shared sender only delivers to the account owner, so with Resend and no
`NOTIFY_FROM` the material is sent to Mr. Ko to forward. Setting either
credential flips this automatically; see `toStudents` in `deliver.js`.

`sendEmail` returns whether the message was *accepted*, and a row is marked
delivered only on that. Marking on intent would silently strand a student.

---

## Still open

1. **One live send.** The cron has never fired and no email has ever gone out.
   Everything upstream is verified; the last hop is not.
2. **Auto-approval is on.** Students can book dates unattended. `update settings
   set value = 'off' where key = 'auto_approve';` reverses it, no deploy.
3. **Math has no materials.** `Practice Tests/<class>` folders exist and are
   empty; the one real practice test sits outside the shared tree. Math
   proposals will report "missing" until they are filed.
4. **Chapter ranges** (above).

## Environment

`DATABASE_URL`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `CALENDAR_ID`,
`CRON_SECRET`, `GMAIL_APP_PASSWORD` — all Production. Optional: `NOTIFY_FROM`
(a verified Resend domain), `MATERIALS_FOLDER_ID`, `GMAIL_USER`, `TEACHER_EMAIL`.

`/api/deliver` is never open: it takes `CRON_SECRET` or a teacher's Google token,
and refuses everything else. It emails children and lists the roster.
