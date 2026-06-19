# Sapporta CLI

The Sapporta CLI creates projects and calls a running Sapporta app. Use it to
inspect the app's API, work with tables, and run data commands against the same
built-in routes your users call from the browser.

## Local Commands

These commands read local project files and do not need a running server:

```bash
pnpm exec sapporta init my-app
```

## API-Backed Commands

These commands call the selected Sapporta API server:

```bash
pnpm exec sapporta describe
pnpm exec sapporta tables
pnpm exec sapporta rows insert <table> --data '[{...}]'
pnpm exec sapporta db exec-sql "SELECT ..."
```

By default, the CLI calls `http://localhost:3000`. Set `SAPPORTA_API_URL` when
the app runs somewhere else:

```bash
export SAPPORTA_API_URL="https://app.example.com"
pnpm exec sapporta describe
```

For a one-off command, pass the URL directly:

```bash
pnpm exec sapporta describe --api-url "https://app.example.com"
```

Command flags override environment variables.

## Protected Apps

Auth-enabled apps usually protect table, SQL, OpenAPI, and custom app routes.
Create an agent access token from your account profile in the app, copy the raw
token once, and store it as `SAPPORTA_API_TOKEN` in your shell, CI system, or
agent secret store:

```bash
export SAPPORTA_API_URL="https://app.example.com"
export SAPPORTA_API_TOKEN="spat_..."

pnpm exec sapporta describe
pnpm exec sapporta tables sample customers
```

You can also pass a token for one command:

```bash
pnpm exec sapporta tables --api-token "spat_..."
```

Do not commit tokens to source control. Revoke tokens you no longer use from the
account profile screen.

## Workspace Scope

An agent access token belongs to one user and one workspace. CLI commands do not
send a workspace id for ordinary data work; the token selects the workspace. To
work in another workspace, switch to that workspace in the app and create a
token for it.

## Custom Endpoints

Use `sapporta describe` to inspect custom endpoints:

```bash
pnpm exec sapporta describe "POST /api/invoices/void"
```

The CLI can call built-in table, row, SQL, and metadata commands. Reports are
app-owned routes, so use `sapporta describe` to inspect them and call the route
with `curl` or another HTTP client:

```bash
curl -fsS \
  -H "Authorization: Bearer ${SAPPORTA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"reason":"duplicate"}' \
  "${SAPPORTA_API_URL}/api/invoices/123/void"
```

```bash
curl -fsS \
  -H "Authorization: Bearer ${SAPPORTA_API_TOKEN}" \
  "${SAPPORTA_API_URL}/api/reports/trial-balance?asOfDate=2026-06-12"
```

## Auth Errors

Protected apps return structured auth errors:

- `unauthenticated`: set or replace `SAPPORTA_API_TOKEN`.
- `token_expired`: create a new token and update your secret.
- `token_revoked`: remove the revoked token and create a replacement if needed.
- `workspace_required`: the token no longer maps to a valid workspace
  membership.
- `forbidden`: the user or token cannot perform that action.

`sapporta describe` uses the same API URL and token as data commands. If
discovery fails with an auth error, fix the token before composing table,
SQL, report, or custom endpoint requests.
