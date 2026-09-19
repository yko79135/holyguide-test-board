# Test Date Board

A small board where Mr. Ko's students propose a math or science test date, he approves
it, and their study guide and practice test are emailed to them a fixed number of days
before the test.

Live: https://holyguide-test-board.vercel.app

## How it works

- **Students** sign in with Google, propose a subject / course / chapter / date, pick a
  class period (or type a time, or leave it open), and can withdraw a proposal while it
  is still pending.
- **Mr. Ko** (`TEACHER_EMAIL`) sees every proposal, approves or declines with an optional
  note, can move an approved test back to pending, and edits the roster — the email
  address each student signs in with and receives materials at.
- **On submission** he gets an email. **On approval** the test lands on his Google
  Calendar.
- Access is closed: the teacher account, plus any address present in the `students`
  table. Anyone else is refused at sign-in.
- A separate scheduled job (not in this repo) reads the board each morning, looks for
  approved tests `lead_days` out, finds that chapter's materials in Drive, and emails
  them — marking the row *Materials sent*.

## Layout

```
src/
  index.html         shell; loads Google Identity Services + app.js
  app.js             the whole UI — vanilla JS, no framework, no build step
  style.css          design tokens, light + dark
  package.json       two dependencies: pg, nodemailer
  api/
    _lib.js          config, PERIODS, Postgres client, Google ID-token verification, board query
    _integrations.js Google Calendar (service account) and Resend email
    config.js        GET  — public: sign-in config, the period table, which integrations are live
    board.js         GET  — the whole board for the signed-in user
    propose.js       POST — student creates a proposal; emails the teacher
    withdraw.js      POST — student removes their own pending proposal
    decide.js        POST — teacher approves / declines / reopens; syncs the calendar
    roster.js        POST — teacher edits a student's email and courses
```

Every endpoint returns the full board after a write, so the client never has to merge
state by hand.

## When a test happens

`PERIODS` in `_lib.js` is the school day — 1교시 09:00–09:40 through 8교시 15:20–16:00 —
and it is the single definition. The server uses it to size calendar events; the client
fetches it from `/api/config` to build the picker. They cannot drift.

A proposal stores `test_period` **or** `test_time`, never a contradiction: choosing a
period sets the time from the table and ignores anything typed. Choosing neither is
allowed and becomes an all-day calendar event, which is honest about what is known
rather than inventing a 9am start.

## The two integrations

Both live in `_integrations.js` and both are **best-effort by construction**. Every
export resolves; none of them throw. A Calendar outage or a bad Resend key must never
turn a successful approval into an error — the row in Postgres is the truth, Google and
Resend are echoes of it. Failures are logged to the Vercel function log and, for the
calendar, surfaced on the board itself: an approved test with no `calendar_event_id`
shows Mr. Ko a line saying so, and approving it again retries.

If the environment variables are absent the features are simply inert. The board behaves
exactly as it did before they existed.

**Calendar auth is a service account, not OAuth.** No user consent screen, no refresh
token to keep alive, and it works from a cold serverless function. The JWT is signed with
`node:crypto` and exchanged for an access token directly — `googleapis` is tens of
megabytes for one signature and one POST. The setup step people miss: the calendar must
be *shared* with the service account's address, with "Make changes to events". Without
that every insert returns 404 for a calendar that plainly exists.

Approve → insert, store the event id. Decline or reopen → delete it and null the column.
Re-approving after a reopen deletes the stale event first, so a proposal never leaves two
events behind.

## Data

Postgres (Supabase), three tables: `students`, `proposals`, `settings`. `settings.lead_days`
controls how many days before a test the materials go out (default 7). Dates are handled
in `Asia/Seoul` — see `seoulToday()`.

`proposals` carries `test_period integer`, `test_time time` and `calendar_event_id text`,
all nullable.

## Running it

Vercel project **holyguide-test-board**, Root Directory `src`, no framework preset.

| Variable | Required | What |
|---|---|---|
| `DATABASE_URL` | yes | Supabase **pooler** connection string (see below) |
| `DATABASE_CA_CERT` | no | pooler CA; supplying it turns on TLS certificate verification |
| `GOOGLE_CLIENT_ID` | no | OAuth Web client id; deployment origin must be an authorized JS origin |
| `TEACHER_EMAIL` | no | the one account with teacher powers |
| `GOOGLE_SA_EMAIL` | no | service account address; calendar must be shared with it |
| `GOOGLE_SA_PRIVATE_KEY` | no | the `private_key` from its JSON key |
| `CALENDAR_ID` | no | which calendar to write to — your own address, not `primary` |
| `RESEND_API_KEY` | no | enables the new-proposal email |
| `NOTIFY_FROM` / `NOTIFY_EMAIL` | no | sender and recipient for that email |
| `APP_URL` | no | link used in the email and the event source |

See `src/.env.example` for the full annotated list.

`DATABASE_URL` has no fallback on purpose. An earlier revision carried a live connection
string inline; that credential has been rotated and must never come back into the source.

## The database is Supabase

The board ran on Neon and now runs on Supabase. The move was a driver swap and nothing
else: every query in `src/api` is a tagged template — ``sql`select ... ${id}` `` — so
`_lib.js` exports a `sql` that keeps exactly that contract, a tagged template in and a
plain array of rows out. `pg` and `@neondatabase/serverless` share `pg-types`, so every
column still arrives parsed the way it always was (`date` and `timestamptz` as `Date`,
`time` and `int8` as string, `jsonb` already inflated). No call site changed.

Two things about Supabase specifically are not optional:

- **The connection string must be a pooler URI.** The direct host,
  `db.<ref>.supabase.co`, has no A record — it is IPv6-only — so a Vercel function
  cannot resolve it. Use the transaction pooler on port 6543, whose user is
  `postgres.<ref>`. In transaction mode the pooler cannot carry named prepared
  statements; `pool.query(text, values)` never creates one, so the client is already in
  the shape that mode requires.
- **TLS is always on, verification is opt-in.** Without `DATABASE_CA_CERT` the
  connection is encrypted but the server's certificate is not verified, because the
  pooler's CA is not in Node's default trust store everywhere. Supply the CA from
  Settings → Database → SSL configuration to close that gap.

`sslmode=disable` in `DATABASE_URL` turns TLS off, which exists so the board can be
pointed at a Postgres on localhost during development. Nothing reachable over a network
should use it.
