# @sapporta/shared

Types, API contracts, and pure helpers shared by `@sapporta/server` and `@sapporta/ui`.

`@sapporta/shared` is the leaf package in the Sapporta monorepo. It is safe to use from browser and server code, and it must not depend on `@sapporta/server` or `@sapporta/ui`.

## Installation

```bash
npm install @sapporta/shared
```

```bash
pnpm add @sapporta/shared
```

## What It Exports

### Contracts

`@sapporta/shared/contracts` contains the Zod schemas, wire-shape types, and ts-rest route contracts used by the Sapporta server and UI.

```ts
import { uiContract, type TableSchema, type Row } from "@sapporta/shared/contracts";
```

### Typed Client Helpers

`@sapporta/shared/client` provides a thin ts-rest client wrapper and the shared API error type.

```ts
import { createApiClient, ApiError } from "@sapporta/shared/client";
import { uiContract } from "@sapporta/shared/contracts";

const client = createApiClient(uiContract, {
  baseUrl: "http://localhost:3000/api",
});
```

### Filters

`@sapporta/shared/filter` owns Sapporta's table filter grammar and serialization helpers.

```ts
import { encodeFilters, decodeFilters, type FilterCondition } from "@sapporta/shared/filter";
```

### Temporal Helpers

`@sapporta/shared/temporal` contains date/time parsing and serialization helpers used consistently across server validation and UI editing.

```ts
import { parseCanonicalInstant, parsePlainDate } from "@sapporta/shared/temporal";
```

### Other Utilities

The package also exposes helpers for value kinds, date ranges, and row IDs:

```ts
import type { ValueKind } from "@sapporta/shared/value-kind";
import type { RowId } from "@sapporta/shared/row-id";
import { allTime, relative, custom } from "@sapporta/shared/daterange";
```

## Package Boundaries

This package is intentionally pure:

- No dependency on `@sapporta/server`
- No dependency on `@sapporta/ui`
- No Node-only APIs in exported contract/client modules
- No framework-specific runtime assumptions

That boundary lets Sapporta keep one source of truth for API contracts and data shapes while allowing projects to compose or replace the server and UI pieces independently.

## License

MIT
