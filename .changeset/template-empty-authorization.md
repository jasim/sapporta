---
"@sapporta/server": patch
---

New projects' token screens treat an empty `Authorization` header beside a
session cookie as the session, as the token resolver already did, instead of
refusing it as a token request. `requestUsesToken` in the template's
`auth-tokens.ts` states the rule once; existing projects keep their copy.
