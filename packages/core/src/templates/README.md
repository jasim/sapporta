# %%SAPPORTA:NAME%%

Uses [Sapporta](https://github.com/jasim/sapporta). TypeScript database
application with a Hono API, SQLite database, and React frontend.

## Run locally

Requires pnpm 11 or later; this project keeps its workspace settings in
`pnpm-workspace.yaml`, which earlier pnpm versions ignore.

```bash
pnpm install
pnpm dev
```

`pnpm dev` prints this project's App and API URLs when it starts. Open the App
URL, `http://localhost:%%SAPPORTA:DEV_FRONTEND_PORT%%`, in a browser.

## Commands

- `pnpm dev` - start backend and frontend in watch mode
- `pnpm typecheck` - typecheck the shared package, API, and frontend
- `pnpm build` - typecheck the workspace, then compile the shared package, API, and frontend
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
- Email verification is required by default when `NODE_ENV=production` and is
  not required otherwise. Set `SAPPORTA_REQUIRE_VERIFIED_EMAIL=true` or `false`
  to override that default.
- `SAPPORTA_API_PORT` controls the API server port. Managed hosts may provide
  the conventional `PORT` variable instead. If both are set, they must match.
- `SAPPORTA_FRONTEND_PORT` controls the Vite frontend server port.
- `SAPPORTA_PUBLIC_APP_URL` is the origin a browser loads this app from. It is
  used for sign-in and for links in outgoing email. In development the browser
  loads the app from Vite, so it carries `SAPPORTA_FRONTEND_PORT`; a deployment
  sets it to its own domain, which has no relation to either port above.
- `SAPPORTA_MAIL_TRANSPORT=stream` prints development emails to the API console.

## Running beside other Sapporta projects

`sapporta init` picked this project's ports above at random, so several projects
run side by side without being reconfigured. When a port is taken anyway,
`pnpm dev` names the setting to change: it checks the frontend port before
starting anything, and the API reports its own port as it boots. Pick a free
port, set it here, and change `SAPPORTA_PUBLIC_APP_URL` too if the frontend
port moved.

`pnpm exec sapporta` reads `SAPPORTA_API_PORT` from this file, so API-backed
commands reach this project's server without further configuration. Pass
`--api-url`, or set `SAPPORTA_API_URL`, only to talk to some other deployment.

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## More docs

- [Sapporta overview](https://github.com/jasim/sapporta#readme)
- [Schema and migrations](https://github.com/jasim/sapporta/blob/main/docs/schema-and-migrations.md)
- [Auth and row security](https://github.com/jasim/sapporta/blob/main/docs/auth.md)
- [CLI](https://github.com/jasim/sapporta/blob/main/docs/cli.md)
- [Reports](https://github.com/jasim/sapporta/tree/main/docs/reports)
