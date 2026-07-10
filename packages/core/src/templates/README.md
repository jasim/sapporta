# %%SAPPORTA:NAME%%

Uses [Sapporta](https://github.com/jasim/sapporta). TypeScript database
application with a Hono API, SQLite database, and React frontend.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

## Commands

- `pnpm dev` - start backend and frontend in watch mode
- `pnpm build` - compile the shared package, API, and frontend
- `pnpm start` - run the production server after `pnpm build`
- `pnpm exec sapporta endpoints list` - inspect the running API

## Project layout

```
sapporta.json       project marker used by the Sapporta CLI
data/               application SQLite database
packages/api/       backend entry point, schema, migrations, and app routes
packages/frontend/  React app, routes, styles, and browser API clients
packages/shared/    API contracts and types shared by backend and frontend
```

## Environment

- `.env.development` is for local development and is ignored by git.
- `.env.production.example` lists the production variables to set in your
  deployment environment.
- `SAPPORTA_API_PORT` controls the API server port. Managed hosts may provide
  the conventional `PORT` variable instead. If both are set, they must match.
- `SAPPORTA_FRONTEND_PORT` controls the Vite frontend server port.
- `SAPPORTA_PUBLIC_APP_URL` must match the browser-facing app origin.
- `SAPPORTA_MAIL_TRANSPORT=stream` prints development emails to the API console.

To run several Sapporta projects at the same time, assign each project a stable
port pair and update its public app URL to match the frontend port:

```env
SAPPORTA_API_PORT=3001
SAPPORTA_FRONTEND_PORT=5174
SAPPORTA_PUBLIC_APP_URL=http://localhost:5174
```

Vite fails when the configured frontend port is occupied instead of silently
selecting another one. API-backed CLI commands are clients of the running app;
set `SAPPORTA_API_URL=http://localhost:3001` in the CLI process or pass
`--api-url http://localhost:3001` when the API is not on the default port.

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## More docs

- [Sapporta overview](https://github.com/jasim/sapporta#readme)
- [Schema and migrations](https://github.com/jasim/sapporta/blob/main/docs/schema-and-migrations.md)
- [Auth and row security](https://github.com/jasim/sapporta/blob/main/docs/auth.md)
- [CLI](https://github.com/jasim/sapporta/blob/main/docs/cli.md)
- [Reports](https://github.com/jasim/sapporta/tree/main/docs/reports)
