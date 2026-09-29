---
"@sapporta/server": patch
---

New projects answer an unmatched `/api/*` path with a JSON 404 whose code is
`ROUTE_NOT_FOUND`. Before, a GET to a mistyped API path fell through to the
frontend and returned `index.html` with status 200, and other methods got a
plain-text 404, so the CLI reported that the server did not return JSON.
`ErrorCode.ROUTE_NOT_FOUND` is exported. Existing projects pick up the
catch-all in `packages/api/boot.ts` through a scaffold refresh.
