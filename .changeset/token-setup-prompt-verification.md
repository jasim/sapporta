---
"@sapporta/frontend": minor
---

The agent setup prompt copied from the account profile page now verifies a new
token with `api get '/api/auth-context'`, which answers with the user and
workspace the token acts as. It asked for `endpoints list`, which answers
without a credential on a local development server, so the check passed even
when the token was never wired into the CLI.
