# __SLUG__-shared — AI Instructions

## This is a leaf package

`__SLUG__-shared` MUST NOT depend on the backend (`packages/api/`) or the
frontend (`packages/frontend/`). It sits below both of them in the dependency
graph so they can import from it without creating cycles.

Both backend and frontend may depend on shared. Shared depends on
neither. If you find yourself wanting to import from backend or frontend
here, the abstraction belongs on the other side of the boundary, not in
this package.

## What belongs here

Types, ts-rest contracts, and pure helpers that would otherwise be
re-declared on both sides of the client/server boundary and drift
silently when one side changes:

- ts-rest contracts (`initContract().router({ ... })`) shared by the
  backend handler (`api.register(route, handler)`) and the frontend
  client (`createApiClient(contract)`).
- Wire-format response/request shapes (e.g. `HelloResponse`).
- Shared value types used by both API handlers and UI state.
- Pure serializers / parsers / constants for those shapes.

## What does NOT belong here

- Anything that imports React, Hono, Drizzle, better-sqlite3, or any
  other framework- or runtime-specific dependency.
- I/O, database access, HTTP handlers, React components.
- Project-specific domain code that only one side uses — that lives in
  `packages/api/app/` (backend) or `packages/frontend/src/` (frontend), not here.

## Allowed runtime dependencies

Only `zod`, `@sapporta/rest-core`, and `@js-temporal/polyfill`. They are
pure-TypeScript with no I/O and no runtime side effects, and they're
required for the contract-as-shared-source-of-truth pattern. Do not add
other runtime deps without revisiting the leaf-package boundary above.

Use Temporal for all time and date work. Do not use `Date`, `dayjs`, or
`date-fns` for parsing, arithmetic, comparison, or formatting.

## Constraints

- Pure TypeScript. No side effects at import time.
- `tsconfig.json` has `composite: true`. The backend imports the built
  `dist/` via the pnpm workspace symlink; the frontend imports the
  source directly via a Vite alias in `packages/frontend/vite.config.ts` (so
  edits hot-reload without a `pnpm --filter ./packages/shared build`).
