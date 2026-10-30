---
"@sapporta/server": patch
---

New projects' `.dockerignore` keeps every root `.env*` file out of the Docker
build context, so `.env.development` (with `BETTER_AUTH_SECRET` and SMTP
settings) and `.env.agent` are no longer uploaded to a build host or copied
into the build stage. The pattern matches only at the project root, so
`packages/frontend/.env.production` still reaches `vite build`. Existing
projects keep their copy; replace its `.env` lines with `.env*` to match.
