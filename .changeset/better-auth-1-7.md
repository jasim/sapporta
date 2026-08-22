---
"@sapporta/server": minor
---

The scaffold now uses Better Auth 1.7. That release keys accounts on
`(issuer, accountId)` and so requires an `account.issuer` column, which the
generated auth schema did not carry: a new project resolved `^1.6.21` to 1.7.1
and every sign-up failed with `The field "issuer" does not exist in the
"account" Drizzle schema`.

`@sapporta/server` now declares `better-auth` as a tilde range, so a generated
project stays on the minor line that `project-auth/schema.ts` was generated
for. Better Auth adds columns in minor releases, and that schema is what a
project's migrations are generated from.

The project's own `personalAccessToken` table moves out of the generated
`project-auth/schema.ts` and into `project-auth/auth-tokens-schema.ts`, which
`drizzle.config.ts` reads alongside it. The generated file is now regenerated
whole without losing the table.
