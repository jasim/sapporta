# Deployment

Sapporta apps are ordinary Node and React applications. Build the shared types,
compile the API package, bundle the frontend, run migrations, then start the API
server with production environment variables.

New projects include a project-local `DEPLOYMENT.md` with exact commands,
topology diagrams, and an environment-variable checklist. Use that file as the
deployment source of truth for the generated app.

## Supported Shapes

Sapporta apps support three common deployment shapes:

- One Node process serves the API and the built React app.
- A reverse proxy serves the app and forwards `/api/*` to the Node process.
- A CDN/static host serves the frontend and a separate host serves the API.

Choose the shape based on how you want to host the frontend and API. The
application code does not need a different programming model for each shape.

## Production Checklist

Run migrations before starting the new server version. Sapporta checks
migration readiness at boot, but it does not apply migrations at runtime.

Keep the SQLite database file on durable storage. If your host uses ephemeral
filesystems, mount a persistent volume or choose a deployment target that gives
the API process stable disk.

Set `SAPPORTA_PUBLIC_BASE_URL` to the browser-facing app origin. Auth links,
callbacks, and default trusted origins are based on that value.

Set a real `BETTER_AUTH_SECRET` for the API process. The local development
secret created by `sapporta init` is not a production secret.

Configure mail delivery if the app sends verification or password-reset emails.
The local `SAPPORTA_MAIL_TRANSPORT=stream` setting is for development logs, not
delivery.

Use exact origins for credentialed browser requests. Do not deploy authenticated
browser traffic with wildcard CORS.

## CLI And Agent Access

After deploying an auth-enabled app, create an agent access token from your
account profile when you want a CLI, coding agent, or CI job to call protected
APIs.

Set `SAPPORTA_API_URL` to the deployed app's API origin and store the raw token
as `SAPPORTA_API_TOKEN` in the caller's secret store:

```bash
export SAPPORTA_API_URL="https://app.example.com"
export SAPPORTA_API_TOKEN="spat_..."

pnpm exec sapporta describe
```

Each token belongs to one user and one workspace. Rotate or revoke tokens from
the account profile when access should change.
