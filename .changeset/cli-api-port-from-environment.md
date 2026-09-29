---
"@sapporta/server": patch
---

The CLI reads `SAPPORTA_API_PORT` the way `pnpm dev` does: from the
environment first, then from the project's `.env.development`. Before, it read
only the file, so after `export SAPPORTA_API_PORT=4000` the server listened on
4000 while API-backed commands still called the file's port. The environment
value is consulted only inside a project, and `PORT` is still not read.
