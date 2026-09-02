# Test Date Board

A small board where Mr. Ko's students propose a math or science test date, he approves
it, and their study guide and practice test are emailed to them a fixed number of days
before the test.

Live: https://holyguide-test-board.vercel.app

## How it works

- **Students** sign in with Google, propose a subject / course / chapter / date, and can
  withdraw a proposal while it is still pending.
- **Mr. Ko** (`TEACHER_EMAIL`) sees every proposal, approves or declines with an optional
  note, can move an approved test back to pending, and edits the roster — the email
  address each student signs in with and receives materials at.
- Access is closed: the teacher account, plus any address present in the `students`
  table. Anyone else is refused at sign-in.
- A separate scheduled job (not in this repo) reads the board each morning, looks for
  approved tests `lead_days` out, finds that chapter's materials in Drive, and emails
  them — marking the row *Materials sent*.

## Layout

```
src/
  index.html      shell; loads Google Identity Services + app.js
  app.js          the whole UI — vanilla JS, no framework, no build step
  style.css       design tokens, light + dark
  package.json    one dependency: @neondatabase/serverless
  api/
    _lib.js       config, Neon client, Google ID-token verification, board query
    config.js     GET  — public: is Google sign-in configured, and with which client id
    board.js      GET  — the whole board for the signed-in user
    propose.js    POST — student creates a proposal
    withdraw.js   POST — student removes their own pending proposal
    decide.js     POST — teacher approves / declines / reopens
    roster.js     POST — teacher edits a student's email and courses
```

Every endpoint returns the full board after a write, so the client never has to merge
state by hand.

## Data

Postgres (Neon), three tables: `students`, `proposals`, `settings`. `settings.lead_days`
controls how many days before a test the materials go out (default 7). Dates are handled
in `Asia/Seoul` — see `seoulToday()`.

## Running it

Vercel project **holyguide-test-board**, Root Directory `src`, no framework preset.

Environment variables — all three are required in production; see `src/.env.example`:

| Variable | What |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `GOOGLE_CLIENT_ID` | OAuth Web client id; deployment origin must be an authorized JS origin |
| `TEACHER_EMAIL` | the one account with teacher powers |

`DATABASE_URL` has no fallback on purpose. An earlier revision carried a live connection
string inline; that credential has been rotated and must never come back into the source.
