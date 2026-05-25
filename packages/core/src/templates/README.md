# __NAME__

A Sapporta project.

## Commands

- `pnpm dev` — start backend and frontend in watch mode
- `pnpm build` — compile shared + backend (`tsc`) and bundle frontend (`vite build`)
- `pnpm start` — run the production server (serves API and SPA on one port)

## Project layout

```
packages/api/       backend — boot.ts, app.ts, schema/, app/, reports/
packages/frontend/  SPA — Vite + React, imports @sapporta/frontend and @sapporta/ui CSS
packages/shared/    ts-rest contracts + types shared by backend and frontend
```

`packages/shared/` is a workspace package (`__SLUG__-shared`). Both `packages/api/` and `packages/frontend/src/` depend on it; it depends on neither. See [`packages/shared/CLAUDE.md`](./packages/shared/CLAUDE.md) for what belongs there.

## Adding an API endpoint

The starter `/api/hello` route shows the pattern. Each endpoint is a trio:

1. **`packages/shared/src/contracts/foo.ts`** — declare a ts-rest contract router (request/response schemas, path, method). One source of truth for the wire shape; re-export it from `packages/shared/src/contracts/index.ts` (which `packages/shared/src/index.ts` barrels through).
2. **`packages/api/app/foo.ts`** — `api.register("foo", contract.foo, handler)`, default-exported. Mount it in `packages/api/app.ts`'s `loadApp()` with `app.route("/", fooApi)`; it's served under `/api`.
3. **`packages/frontend/src/api.ts`** — pass the contract to `createApiClient(contract, { baseUrl: getApiBase })`. Frontend code calls `customApi.foo()` and gets a fully typed response or throws `ApiError`.

Because both sides import the same contract, request and response types can never drift — change the contract once and both ends light up red until they match.

Delete the `hello` trio (`packages/shared/src/contracts/hello.ts`, `packages/api/app/hello.ts`, `packages/frontend/src/api.ts` entry, sidebar/Welcome wiring) once your own routes take over.

## Running multiple projects on one machine

Each backend binds to `PORT` (default `3000`). To run several Sapporta projects
side-by-side, give each one its own port:

```bash
PORT=3001 pnpm dev   # project foo
PORT=3002 pnpm dev   # project bar (in another terminal)
```

`packages/frontend/vite.config.ts` reads the same `PORT` variable to point its `/api`
proxy at the right backend. Vite's own dev-server port (`5173`) auto-increments
on collision, so the frontend side takes care of itself. No `.env`, no
`VITE_API_URL`, no CORS.

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the three supported deployment
shapes (single process, reverse proxy, split topology with CDN + separate
API host), and the env vars each one needs.
