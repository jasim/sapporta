---
"@sapporta/server": minor
---

Move test utilities off the root export and onto a dedicated
`@sapporta/server/testing` subpath. `createTestDb` no longer ships on
the production surface of `@sapporta/server`; import it (and the newly
public `createTestConnection`) from `@sapporta/server/testing` instead.
