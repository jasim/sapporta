---
"@sapporta/server": minor
---

The CLI reads the API token from the surrounding project's `.env.agent`
(`SAPPORTA_API_TOKEN=…`) when neither `--api-token` nor `SAPPORTA_API_TOKEN`
sets one, the way it reads the project's port, and reports that source as
`project`. `PROJECT_API_TOKEN_FILE`, `readProjectApiToken` and
`writeProjectApiToken` are exported, so an app that provisions its agents'
token writes the file the CLI reads.

- The project's token goes only to the project's own API. When `--api-url` or
  `SAPPORTA_API_URL` chooses the URL, it is withheld, and an auth failure
  says so (`withheld`); pass `--api-token` or set `SAPPORTA_API_TOKEN` to send
  a token there.
- An `.env.agent` that exists but cannot be read stops every CLI command with
  an error naming the file.
- `writeProjectApiToken` writes a new owner-only file and renames it into
  place, so a symlink at the path is replaced, not followed. It throws on a
  comment that spans lines and on a token the file would not read back as
  written, such as a blank one or one containing `#` or quotes.
- New projects' `.dockerignore` keeps `.env.agent` out of the Docker build
  context. Existing projects keep their copy; add `.env.agent*` to it.
