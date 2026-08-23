---
"@sapporta/server": minor
---

Generated projects now ship `pnpm seed`: `packages/api/seed.ts` for the sample
rows, and `packages/api/script-runtime.ts`, which opens the application with no
server running. Rows written there go through the app's own save path, with the
same validation, column defaults, and ownership stamping a request from the
browser gets, so seeded data is data the app could have produced. Filling a new
app used to mean signing up over HTTP against the running server, keeping
Set-Cookie across calls, sending an origin CORS would accept, and reading the
API port out of `.env.development` — eighty lines of plumbing before the first
row, none of it necessary, because a script runs on the same machine as the
database. Agent access tokens cannot close the gap either: only a signed-in
person can create one, and a freshly scaffolded app has no account yet.

`openScriptRuntime()` is the general way in and is meant to be reused: a
nightly job, a one-off import, or a maintenance task gives it an address and a
password and gets that person's row access, the same as a request would. The
account is proved, not named — signing in there means holding the password,
exactly as it does in a browser — so there is nothing in that file for a caller
to borrow, and no way to act as an account whose password it does not have. It
is still not for a route: a served request already carries the row access it
earned, at `c.get("auth")`.

`packages/api/seed-runtime.ts` is that same call with the sample-data account
wired in, and the sample-data account is the one thing here that needs
guarding, because its password is written in the source. Creating it skips what
the sign-up route does to protect a real address: the rate limit, the
trusted-origin check, and the verification email. So the guard sits on the
capability rather than on the script that calls it —
`project-auth/sample-data.ts` refuses unless `.env.development` sets
`SAPPORTA_ALLOW_SAMPLE_DATA_SEEDING=true` and `NODE_ENV` is not `production`,
and both the account creation and the verified-address write check it
themselves. A route that reached either one is refused for the same reason the
seed script is. The permission is granted rather than merely not withheld, so
an environment that never heard of the setting is refused instead of being
taken for a developer's machine.

The two sharp methods on the project's auth object now say what they cost.
`createSampleDataAccount()` names what it is for and checks the permission
before doing anything, and `verifyEmailPasswordWithoutRateLimit()` says in its
name that the throttle in front of the sign-in route counts HTTP requests and
therefore does not apply to it — it is for a command-line script, where there
is no caller to throttle, and never for a route.

`boot.ts` and the script runtime both start from `openProjectRuntime()` in
`packages/api/runtime.ts`, which returns the `close()` both call, so the HTTP
server and `pnpm seed` cannot drift apart. It defaults mail off for a script,
because the addresses in a database belong to people who did not ask a script
to write to them, and it takes the anonymous-route list as an option from
`boot.ts` rather than importing `app.ts`, so opening the app does not pull in
every route module.

Reads of the account table live in `packages/api/project-auth/user.ts`, over
the generated Drizzle schema, and agent tokens share them, so the three ways of
identifying a person cannot disagree about what an account is. That module
reads only; the one write `pnpm seed` needs belongs to `sample-data.ts`
alongside the permission that guards it. `project-auth/index.ts` also names its
workspace exports one by one instead of re-exporting the module wholesale, so
adding a function there cannot publish it by accident. `userPrincipal()` now
returns the new `UserPrincipal` type rather than the wider `Principal`, so
callers that have already established there is a user no longer have to narrow.

A script picks the first workspace its account belongs to, and a browser
prefers whichever workspace the session is already in and falls back to the
same one. The two therefore agree for an account with a single workspace and
for a session that has not chosen one, which covers a freshly seeded project;
they part company only for a person with several workspaces who has switched.

`authz/resolveRequestDataAuthority()` is unchanged and still the only place a
served request's row access is decided; its comment now describes what the
starter app actually grants a signed-in request, which is everything in its
active workspace rather than only that account's own rows.
