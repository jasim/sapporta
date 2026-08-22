---
"@sapporta/server": minor
---

`/` now opens a screen behind `AuthGate`. The generated `App.tsx` exported
`appHomeRoute` outside the gate, and the shipped default was a redirect to
`/welcome`, so the gate caught anonymous visitors one hop later and nothing
looked wrong. A project that put a real home page in that slot — which the
app-building guidance asks for — served it to visitors without a session.

`appHomeRoute` now renders inside the gate and holds the home screen itself:
`Welcome.tsx` becomes `Home.tsx`, `/` opens it, and `/welcome` is gone, so
signing in lands on the home page without a redirect hop. A new
`appPublicHomeRoute` export takes an index route for an app that wants `/` open
to everyone; filling it opens `/` in place of `appHomeRoute`, so one of the two
owns `/` and the other is unreachable there.

A project owns `App.tsx` and keeps its own copy when it updates Sapporta, while
`SapportaApp.tsx` is replaced and reads both slots. To take the change, add
`export const appPublicHomeRoute: ReactElement | null = null;` to `App.tsx` and
move the home screen from a redirect into `appHomeRoute`.
