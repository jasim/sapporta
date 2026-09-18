---
"@sapporta/server": minor
---

Export `createTestAuthContext` from `@sapporta/server/testing`. It builds a
real auth context, with real row security over the tables it is given, for a
workspace/user-scoped member, so an app's tests can call row-scoped code
without faking `rowSecurity`.
