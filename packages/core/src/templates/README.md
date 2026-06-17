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
- `pnpm exec sapporta check` - validate local project files
- `pnpm exec sapporta describe` - inspect the running API

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
- `PORT` controls the API server port. `FRONTEND_DEV_PORT` controls the Vite dev
  server port.
- `SAPPORTA_PUBLIC_BASE_URL` must match the browser-facing app origin.
- `SAPPORTA_MAIL_TRANSPORT=stream` prints development emails to the API console.

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## More docs

- [Sapporta overview](https://github.com/jasim/sapporta#readme)
- [Schema and migrations](https://github.com/jasim/sapporta/blob/main/docs/schema-and-migrations.md)
- [Auth and row security](https://github.com/jasim/sapporta/blob/main/docs/auth.md)
- [CLI](https://github.com/jasim/sapporta/blob/main/docs/cli.md)
- [Reports](https://github.com/jasim/sapporta/tree/main/docs/reports)
