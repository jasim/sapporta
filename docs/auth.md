# Sapporta Auth: Building Row-Safe Apps With Workspaces

Sapporta projects start with an auth-ready application structure. You get
email/password sign-in, Better Auth API routes, session-backed request auth,
workspace provisioning, active workspace selection, role resolution, route
guards, frontend auth context APIs, and row-scoped generated table APIs.

The main rule is simple: row ownership lives in the database, but clients do not
get to choose it. A signed-in request resolves to an active workspace, a user,
membership roles, an application ability, and request data authority. The
standard table API is `scopedRows(db, auth, table)`. It uses the request's data
authority to stamp trusted scope columns on inserts and to add SQL predicates
to reads, updates, deletes, lookups, exports, and counts.

## What You Get In A New Sapporta Project

A new Sapporta project includes:

- Better Auth configured as the default sign-in system.
- Email/password auth pages and `/api/auth/*` routes.
- Better Auth verification/reset email callbacks wired to the generated project
  mailer.
- Session-backed auth middleware for API requests.
- First-workspace provisioning.
- Active workspace selection.
- Owner/member role resolution.
- Route guards for product routes and framework/admin routes.
- Frontend auth context APIs and an `AuthGate`.
- Agent access tokens for CLI, coding agent, and CI access to protected APIs.
- Generated table operations that protect rows by workspace and user scope.
- Request data authority helpers for custom product code.

## Environment

Local development uses `.env.development`, created by `sapporta init` and
ignored by git. It includes local defaults such as:

```env
BETTER_AUTH_SECRET=...
SAPPORTA_PUBLIC_BASE_URL=http://localhost:5173
FRONTEND_DEV_PORT=5173
SAPPORTA_MAIL_TRANSPORT=stream
```

For production, set at least:

- `BETTER_AUTH_SECRET`: a real signing secret.
- `SAPPORTA_PUBLIC_BASE_URL`: the browser-facing app origin, used for auth
  links, callbacks, and trusted credentialed requests.
- Mail settings such as `SAPPORTA_MAIL_TRANSPORT`, `SAPPORTA_MAIL_FROM`, and
  SMTP configuration if the app sends verification or reset emails.
- Any database path, storage, or app-specific secrets your project adds.

Credentialed auth requests need exact origins. Do not deploy with wildcard CORS
for authenticated browser traffic.

For ordinary table work, use the row-scoped table API exported by
`@sapporta/server`:

```ts
const auth = projectAuth.requireAuthorizedWorkspaceUserData(c, {
  action: "create",
  subject: "invoices",
});
const rows = scopedRows(c.get("db"), auth, invoices);
```

Generated `/api/tables/*` routes use the same API. Custom product routes should
first choose the narrowest data authority that matches the workflow, then pass
that auth context to `scopedRows()` for ordinary list, get, create, update,
delete, lookup, count, and export work. When a route needs a custom Drizzle
workflow, such as joins, transactions, aggregates, or domain-specific
invariants, use the lower-level row-security primitives described later in this
guide.

- If you use generated table routes, Sapporta applies row protection for you.
- If you write ordinary custom table operations, start with
  `scopedRows(db, auth, table)` after selecting the route's data authority.
- If you write advanced Drizzle workflows, use the lower-level row-security
  primitives explicitly.
- You still own and can edit the project auth code copied into
  `packages/api/project-auth` and `packages/api/authz`.

## The Running Example

The examples below use invoices created by POS operators.

- `invoices`: `workspaceUserScoped`
- `invoice_lines`: `workspaceUserScoped`
- `customers`: usually `workspaceGlobal`
- `products`: usually `workspaceGlobal`
- `tax_rates` or `countries`: usually `systemGlobal`

A cashier signs in. Sapporta resolves the session, active workspace, user, and
membership. Invoice rows are scoped to both the active workspace and the current
cashier. Another cashier in the same workspace does not see those invoices.
For example, an owner-only route may allow a store owner to void one of their
own invoices, but `scopedRows(db, auth, invoices)` still only sees rows allowed
by the auth context's data authority. It does not become an "all cashiers'
invoices" query just because the route checked an owner role.

For user-owned invoices:

```ts
meta: {
  rowScope: "workspaceUserScoped",
  rowLabelColumns: ["invoice_number"],
}
```

That table must have both:

- `workspace_id`
- `scoped_to_user_id`

## Start With A Table

Define the Drizzle table with explicit scope columns, then wrap it with
Sapporta metadata:

```ts
import { integer, sqliteTable, table, text } from "@sapporta/server/table";

export const invoicesTable = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
  invoice_number: text("invoice_number").notNull(),
  customer_id: integer("customer_id").notNull(),
  total: integer("total").notNull(),
  status: text("status").notNull(),
});

export const invoices = table({
  drizzle: invoicesTable,
  meta: {
    label: "Invoices",
    rowScope: "workspaceUserScoped",
    rowLabelColumns: ["invoice_number"],
    references: {
      customer_id: { table: "customers" },
    },
  },
});
```

`rowScope` says who can see the row. The scope columns store the trusted
workspace/user boundary. The client does not submit those columns. Sapporta
writes them from the current auth context.

`table()` currently defaults an omitted `rowScope` to
`workspaceUserScoped`, the strictest scope. Keep examples and production schemas
explicit anyway; auth boundaries are design decisions, not incidental defaults.

## Choose A Row Scope

Use `workspaceUserScoped` when records belong to one user inside a workspace:
POS invoices, personal tasks, drafts, private notes.

Use `workspaceGlobal` when records are shared by all users in one workspace:
customers, products, chart of accounts, locations.

Use `systemGlobal` for installation-wide reference data: countries, standard
tax categories, currencies.

For the POS example, cashier-created `invoices` and `invoice_lines` are
`workspaceUserScoped`. `customers` and `products` are usually
`workspaceGlobal`. Reference lists such as countries are usually `systemGlobal`.

## Boot The Auth-Enabled App

The generated `packages/api/boot.ts` is intentionally ordinary application
code. In current templates it:

1. Finds the project root.
2. Connects SQLite.
3. Loads Sapporta schemas and reports.
4. Checks migration readiness while loading the Sapporta project.
5. Validates auth schema metadata for the loaded table catalog.
6. Creates project auth from Better Auth config, ability rules, data-authority
   resolution, and the loaded catalog.
7. Creates the Hono app.
8. Installs request logging, exact-origin credentialed CORS, error handling,
   and health policy.
9. Mounts Better Auth at `/api/auth/*`.
10. Installs DB request context for `/api/*`.
11. Installs project auth middleware for `/api/*`, skipping `/api/auth/*`.
12. Mounts Sapporta framework routes.
13. Mounts custom app routes.
14. Mounts auth-context routes.
15. Mounts OpenAPI and frontend assets.

By the time a protected product or framework route runs, `c.get("db")`,
`c.get("sqlite")`, and `c.get("auth")` are available.

Credentialed CORS must use exact origins. The generated boot uses
`installExactOriginCors()`, which rejects wildcard origins when credentials are
enabled.

Project auth middleware failures return JSON auth codes:

- `401 unauthenticated`
- `403 email_not_verified`
- `403 workspace_required`
- `403 forbidden`

The generated guard helpers all read the already-resolved `c.get("auth")`.
Use them to require the right principal, ability, and data authority before a
handler touches table-backed data:

- `requirePrincipalUser(c)`
- `requireVerifiedUser(c)`
- `requireAuthorizedSystemData(c, requirement)`
- `requireAuthorizedWorkspaceData(c, requirement)`
- `requireAuthorizedWorkspaceUserData(c, requirement)`
- `requireAuthorizedInteractiveWorkspaceUserData(c, requirement)`
- `requireWorkspaceRowsAllowed(c)`
- `requireWorkspaceOwner(c)`

## Project Auth Files

The source template for generated project auth lives in
`packages/core/src/templates/project-auth`. `sapporta init` copies it once into
local project code. Ability and data-authority defaults live beside it in
`packages/api/authz`:

```txt
packages/api/authz/
  ability.ts
  request-data-authority.ts
  types.ts

packages/api/project-auth/
  index.ts
  better-auth.ts
  context.ts
  workspace.ts
  routes.ts
  schema.ts
  env.ts
  middleware.ts
  errors.ts
  auth-tokens.ts
```

Generated projects own those files. They may customize workspace provisioning,
role mapping, ability rules, data-authority resolution, middleware behavior,
guard policy, error responses, and auth routes without changing
`@sapporta/server`.

- `authz/ability.ts`: defines what feature actions each principal may perform.
- `authz/request-data-authority.ts`: chooses the trusted row facts available to
  each request.
- `authz/types.ts`: defines app-specific roles, ability subjects, and auth
  facts.
- `env.ts`: parses auth secrets, API base URL, frontend origins, verified-email
  policy, mail delivery config, and health policy.
- `better-auth.ts`: creates the Better Auth instance with email/password and
  the organization plugin.
- `emails.ts`: composes Better Auth verification/reset emails and sends them
  through `packages/api/mailer.ts`.
- `schema.ts`: defines the Better Auth Drizzle schema.
- `context.ts`: converts the Better Auth session and organization membership
  into `SapportaAuthContext`.
- `workspace.ts`: handles membership lookup, active workspace selection,
  initial workspace provisioning, workspace switching, and role mapping.
- `routes.ts`: implements `GET /api/auth-context` and
  `POST /api/auth-context/active-workspace`, plus token-management routes used
  by the account profile screen.
- `middleware.ts`: installs request auth resolution, public route skipping,
  verified-email policy, and project-owned route guards.
- `errors.ts`: defines project auth JSON error responses.
- `auth-tokens.ts`: creates, resolves, lists, and revokes workspace-scoped
  agent access tokens.

Generated migrations create Better Auth tables and product tables before the
app serves requests. Boot checks migration readiness only; it must not mutate
schema at runtime.

## Sign Up And Resolve Auth Context

On first login, Better Auth creates or reads the session. Project auth resolves
the active workspace. If the user has no workspace membership yet, the generated
project auth code provisions an initial workspace and owner membership. Better
Auth organization membership roles are mapped into Sapporta roles:
`owner`/`admin` become `owner`; everything else becomes `member`.

The request receives a `SapportaAuthContext`:

```ts
interface SapportaAuthContext {
  principal: Principal;
  dataAuthority: RequestDataAuthority;
  ability: AppAbility;
  rowSecurity: RowSecurity;
}
```

Read those as separate facts:

- `principal`: who is asking, such as anonymous or a signed-in user with active
  workspace membership.
- `dataAuthority`: which trusted ownership facts database helpers may use.
- `ability`: what feature actions the principal may perform.
- `rowSecurity`: how data authority and table metadata become SQL predicates,
  trusted insert values, and reference checks.

Data authority is not a permission grant. A CASL rule can allow a feature
action without widening row predicates, and an owner role does not automatically
turn user-owned rows into workspace-wide rows.

## Customize Request Data Authority

Generated projects build data authority in
`packages/api/authz/request-data-authority.ts`. The starter policy gives
anonymous requests access only to system-global data and gives signed-in
workspace users all three row-authority slots for their active workspace:

```ts
import {
  requestDataAuthority,
  systemGlobalOnlyAuthority,
  workspaceGlobalOnlyAuthority,
  workspaceUserScopedAuthority,
  type RequestDataAuthority,
} from "@sapporta/server";
import type { Context } from "hono";
import type { AppPrincipal } from "./types.js";

export async function resolveRequestDataAuthority(input: {
  principal: AppPrincipal;
  c: Context;
}): Promise<RequestDataAuthority> {
  if (input.principal.kind !== "user") {
    return requestDataAuthority({
      systemGlobalOnly: systemGlobalOnlyAuthority(),
    });
  }

  const workspace = input.principal.membership.workspace;
  return requestDataAuthority({
    systemGlobalOnly: systemGlobalOnlyAuthority(),
    workspaceGlobalOnly: workspaceGlobalOnlyAuthority(workspace),
    workspaceUserScoped: workspaceUserScopedAuthority({
      workspace,
      user: input.principal.user,
    }),
  });
}
```

Customize this file when a product route intentionally needs a different data
boundary. For example, a public workspace catalog route should first verify that
the requested workspace has enabled that public catalog, then return
`workspaceGlobalOnlyAuthority(workspace)` for that request. Do not infer row
authority from a role alone; roles belong in `authz/ability.ts`, while
ownership facts belong in data authority.

## Protect Product Routes

Generated table routes authorize the requested action with `auth.ability` and
then run through `scopedRows()`. Product/domain routes should follow the same
shape:

1. Choose the helper that matches the workflow's required data authority.
2. Pass the returned auth context to `scopedRows()` for ordinary table work, or
   to `auth.rowSecurity.forTable(table)` for custom Drizzle workflows.

For user-owned rows such as `workspaceUserScoped` invoices:

```ts
import { scopedRows } from "@sapporta/server";

api.register(
  "createInvoice",
  contract.createInvoice,
  async ({ c, request }) => {
    const db = c.get("db");
    const auth = projectAuth.requireAuthorizedWorkspaceUserData(c, {
      action: "create",
      subject: "invoices",
    });
    const rows = scopedRows(db, auth, invoices);

    const created = await rows.create(request.body);
    return { status: 201, body: { data: created } };
  },
);
```

For workspace-wide shared rows such as `workspaceGlobal` customers:

```ts
api.register(
  "createCustomer",
  contract.createCustomer,
  async ({ c, request }) => {
    const auth = projectAuth.requireAuthorizedWorkspaceData(c, {
      action: "create",
      subject: "customers",
    });
    const rows = scopedRows(c.get("db"), auth, customers);

    const created = await rows.create(request.body);
    return { status: 201, body: { data: created } };
  },
);
```

For installation-wide reference rows such as `systemGlobal` countries:

```ts
api.register(
  "listCountries",
  contract.listCountries,
  async ({ c, request }) => {
    const auth = projectAuth.requireAuthorizedSystemData(c, {
      action: "read",
      subject: "countries",
    });
    const rows = scopedRows(c.get("db"), auth, countries);

    return { status: 200, body: await rows.list(request.query) };
  },
);
```

For browser-only workflows, such as token management or profile settings that
must not be callable with an agent access token:

```ts
const auth = projectAuth.requireAuthorizedInteractiveWorkspaceUserData(c, {
  action: "create",
  subject: "agent_access_token",
});
```

The `requireAuthorized*Data()` helpers do two things: they check
`auth.ability.can(action, subject)`, and they return an auth context whose
`dataAuthority` and `rowSecurity` are narrowed to the requested row-authority
slot. If a route chooses workspace data authority and then tries to access a
`workspaceUserScoped` table, row security fails closed.

Client-provided `workspace_id` or `scoped_to_user_id` is rejected. Trusted scope
values are inserted from auth. Reads, updates, deletes, lookups, counts, and
exports are all scoped by the same auth context.

## Default: Use `scopedRows()`

Use `scopedRows()` when the route is doing normal table work: list rows, get one
row, create rows, update a row, delete a row, power a lookup, count child rows,
or export rows. This is the path generated `/api/tables/*` routes use.

```ts
api.register(
  "listMyInvoices",
  contract.listMyInvoices,
  async ({ c, request }) => {
    const db = c.get("db");
    const auth = projectAuth.requireAuthorizedWorkspaceUserData(c, {
      action: "read",
      subject: "invoices",
    });
    const rows = scopedRows(db, auth, invoices);

    const result = await rows.list(request.query);
    return { status: 200, body: result };
  },
);

api.register("getInvoice", contract.getInvoice, async ({ c, request }) => {
  const auth = projectAuth.requireAuthorizedWorkspaceUserData(c, {
    action: "read",
    subject: "invoices",
  });
  const rows = scopedRows(c.get("db"), auth, invoices);

  const invoice = await rows.get(request.params.id);
  return { status: 200, body: { data: invoice } };
});

api.register("voidInvoice", contract.voidInvoice, async ({ c, request }) => {
  const auth = projectAuth.requireAuthorizedWorkspaceUserData(c, {
    action: "update",
    subject: "invoices",
  });
  const rows = scopedRows(c.get("db"), auth, invoices);

  const invoice = await rows.update(request.params.id, { status: "void" });
  return { status: 200, body: { data: invoice } };
});

api.register(
  "deleteInvoice",
  contract.deleteInvoice,
  async ({ c, request }) => {
    const auth = projectAuth.requireAuthorizedWorkspaceUserData(c, {
      action: "delete",
      subject: "invoices",
    });
    const rows = scopedRows(c.get("db"), auth, invoices);

    const deleted = await rows.delete(request.params.id);
    return { status: 200, body: { data: deleted } };
  },
);
```

`scopedRows()` owns the boring but security-sensitive details:

- `list(query)`: parses filters/search/sort/pagination and composes them
  through row ownership.
- `get(id)`: selects by primary key inside row ownership.
- `create(input)`: rejects client-managed scope fields, validates references,
  stamps trusted scope fields, and persists through `savePipeline()`.
- `update(id, patch)`: rejects client-managed fields, validates references, and
  updates by primary key inside row ownership.
- `delete(id)`: deletes by primary key inside row ownership.
- `lookup(query)`, `count(query)`, and `exportRows(query)`: use the same scoped
  row visibility as the normal read path.

Never fetch broadly and filter in JavaScript. If ordinary table operations do
not fit the workflow, drop to the lower-level primitives below and compose row
ownership into SQL yourself.

## Advanced: Use Row-Security Primitives

Use `auth.rowSecurity.forTable(table)` directly when you need a custom Drizzle
workflow: joins, transactions, aggregates, multi-table state transitions,
custom SQL, or domain-specific invariants that `scopedRows()` cannot express.

```ts
const auth = projectAuth.requireAuthorizedWorkspaceUserData(c, {
  action: "create",
  subject: "invoice_workflow",
});
const invoiceGuard = auth.rowSecurity.forTable(invoices);
const lineGuard = auth.rowSecurity.forTable(invoiceLines);
```

Use one guard per table because each table has its own row scope and reference
rules. Choose the authority helper for the tables the workflow actually touches:
`requireAuthorizedWorkspaceUserData()` for `workspaceUserScoped`,
`requireAuthorizedWorkspaceData()` for `workspaceGlobal`, and
`requireAuthorizedSystemData()` for `systemGlobal`.

### Read Rows With Custom SQL

Compose the row predicate into the SQL query:

```ts
import { eq } from "drizzle-orm";

const rows = await db
  .select()
  .from(invoicesTable)
  .where(invoiceGuard.ownedRows(eq(invoicesTable.status, "open")));
```

`ownedRows()` adds `workspace_id = active workspace`. For
`workspaceUserScoped`, it also adds `scoped_to_user_id = current user`.

### Prepare Insert Values

Use `insertValues()` when custom Drizzle code inserts a normal client payload.
It:

1. Rejects client-managed scope fields.
2. Rejects client-submitted `clientCanSet: false` references.
3. Merges trusted `serverValues`.
4. Validates FK visibility after the trusted values are merged.
5. Stamps trusted scope fields.

Pass server-authored values, such as a just-created parent `invoice_id`, through
`serverValues`. Do not merge them into client input before policy checks.

### Prepare Update Patches

Primary key alone is never authorization. Prepare patches with `patchValues()`
and scope the mutation with `ownedRows()`:

```ts
api.register("voidInvoice", contract.voidInvoice, async ({ c, request }) => {
  const db = c.get("db");
  const auth = projectAuth.requireAuthorizedWorkspaceUserData(c, {
    action: "update",
    subject: "invoices",
  });
  const invoiceGuard = auth.rowSecurity.forTable(invoices);

  await db
    .update(invoicesTable)
    .set(await invoiceGuard.patchValues(db, { status: "void" }))
    .where(invoiceGuard.ownedRows(eq(invoicesTable.id, request.params.id)));

  return { status: 200, body: { ok: true } };
});
```

Delete routes follow the same rule: `where(guard.ownedRows(eq(pk, id)))`.

## Worked Example: Invoice With Lines

The detail table has its own scope columns and its own Sapporta table metadata:

```ts
export const invoiceLinesTable = sqliteTable("invoice_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
  invoice_id: integer("invoice_id").notNull(),
  product_id: integer("product_id").notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  line_total: integer("line_total").notNull(),
});

export const invoiceLines = table({
  drizzle: invoiceLinesTable,
  meta: {
    label: "Invoice Lines",
    rowScope: "workspaceUserScoped",
    rowLabelColumns: ["description"],
    references: {
      invoice_id: { table: "invoices", clientCanSet: false },
      product_id: { table: "products" },
    },
  },
});
```

A compact contract can model the route as one invoice payload plus an array of
line payloads:

```ts
const createInvoiceBody = z.object({
  invoice: z.object({
    invoice_number: z.string(),
    customer_id: z.number(),
    total: z.number(),
    status: z.string(),
  }),
  lines: z.array(
    z.object({
      product_id: z.number(),
      description: z.string(),
      quantity: z.number(),
      line_total: z.number(),
    }),
  ),
});
```

The route inserts the invoice first, then inserts the lines with
`invoice_id` supplied as a trusted server value:

```ts
api.register(
  "createInvoice",
  contract.createInvoice,
  async ({ c, request }) => {
    const db = c.get("db");
    const auth = projectAuth.requireAuthorizedWorkspaceUserData(c, {
      action: "create",
      subject: "invoice_workflow",
    });
    const invoiceGuard = auth.rowSecurity.forTable(invoices);
    const lineGuard = auth.rowSecurity.forTable(invoiceLines);

    const created = await db.transaction(async (tx) => {
      const invoice = await tx
        .insert(invoicesTable)
        .values(await invoiceGuard.insertValues(tx, request.body.invoice))
        .returning()
        .get();

      const lines = await lineGuard.insertManyValues(tx, request.body.lines, {
        serverValues: () => ({ invoice_id: invoice.id }),
      });

      await tx.insert(invoiceLinesTable).values(lines);
      return { invoice, lines };
    });

    return { status: 201, body: { data: created } };
  },
);
```

Both tables are `workspaceUserScoped` because the invoice header and detail rows
belong to the same cashier inside the active workspace. `invoice_id` is
`clientCanSet: false` because the server chooses it after creating the parent.
If the client submits `workspace_id`, `scoped_to_user_id`, or `invoice_id` on a
line, the row-security helper rejects the payload before insert. If the client
references a customer or product that is not visible in the active auth
boundary, FK validation fails even if that primary key exists.

## References And FK Visibility

Prefer Drizzle `.references()` when the database has a physical FK:

```ts
customer_id: integer("customer_id").references(() => customersTable.id);
```

Use `meta.references` for logical FKs or to refine policy:

```ts
references: {
  customer_id: { table: "customers" },
  invoice_id: { table: "invoices", clientCanSet: false },
}
```

FK validation checks target-row visibility, not just existence. A primary key in
another workspace fails. A user-scoped target row owned by another user fails
for normal user-scoped routes. `systemGlobal` reference rows are validated
through system-global visibility.

Auth schema validation rejects unresolved target tables, unknown source
columns, missing target columns, conflicts between Drizzle metadata and
`meta.references`, ambiguous duplicate source columns, and composite foreign
keys. There is no naming-convention fallback for FK authorization.

Lower-level FK validation uses `lookupRowAccessPredicate()` so autocomplete,
lookup, and write validation share the same target-row visibility. Update paths
validate only FK fields present in the patch; create paths validate submitted
non-null FK values after trusted server values are merged.

## How Generated Table Routes Use `scopedRows()`

Generated `/api/tables/*` routes are always mounted behind auth in the default
template; there is no unauthenticated generated table-handler path. Each route
resolves auth, creates `scopedRows(db, auth, table)`, and keeps HTTP concerns in
the handler:

- `list`: `rows.list(query)` applies row ownership before filters, sort,
  pagination, and count.
- `get`: `rows.get(id)` selects by primary key inside row ownership.
- `create`: `rows.create(body)` prepares client input and stamps trusted scope
  fields before persistence.
- `update`: `rows.update(id, patch)` prepares the patch and updates by primary
  key inside row ownership.
- `delete`: `rows.delete(id)` deletes by primary key inside row ownership.
- `lookup`: `rows.lookup(query)` applies row ownership before autocomplete
  results.
- `count`: `rows.count(query)` applies row ownership before grouping.
- `export`: `rows.exportRows(query)` applies row ownership before filters,
  sort, and output.

Framework table routes are mounted with `projectAuth.requireAuthContext` in the
generated template. Each handler then checks `auth.ability.can(action,
table.sqlName)` before calling `scopedRows(db, auth, table)`. A broad ability
rule such as `can("manage", "all")` can allow the generated action, but it does
not broaden row visibility. Row visibility still comes only from the resolved
`auth.dataAuthority`.

Rows outside the active auth boundary return `404` for generated get, update,
and delete. Update and delete do not perform a prior broad fetch followed by a
primary-key-only mutation.

## Frontend Runtime

Public auth pages render without loading Sapporta table/report metadata:

- `/login`
- `/signup`
- `/verify-email`
- `/forgot-password`
- `/reset-password`

The signup page includes this copy:

```text
You are creating a new workspace and will be its owner.
```

After login, the frontend loads in this order:

1. Better Auth session.
2. `GET /api/auth-context`.
3. Active workspace and membership summary.
4. Sapporta table/report/project metadata.

`AuthGate` routes users to login, verify-email, signup, or the app shell based
on auth state. Non-owner workspace users may enter product app routes, but
owner-only framework navigation for tables, reports, metadata, and OpenAPI
should be hidden. Workspace switching calls
`POST /api/auth-context/active-workspace`, resets schema metadata, and stores
the returned auth context.

Generated forms omit system-managed fields:

- `workspace_id`
- `workspaceId`
- `scoped_to_user_id`
- `scopedToUserId`

They also omit columns whose schema metadata exposes `clientEditable: false`.
FK controls should render only for resolved references so lookup visibility and
write validation use the same target-row boundary.

The frontend guard is a user-experience boundary only; backend route guards and
row-security predicates are authoritative.

## Agent Access Tokens

Use an agent access token when a non-browser client needs to call protected app
APIs: the Sapporta CLI, a coding agent, a scheduled job, or CI.

Create tokens from the account profile screen while signed in. The create
response shows the raw token once. Copy it into the caller's secret store as
`SAPPORTA_API_TOKEN`:

```bash
export SAPPORTA_API_URL="https://app.example.com"
export SAPPORTA_API_TOKEN="spat_..."

pnpm exec sapporta describe
pnpm exec sapporta tables
```

A token belongs to the signed-in user and the active workspace. Ordinary CLI data
commands do not send a workspace id; the token selects the workspace. To call the
same app as another workspace, switch workspaces in the app and create a token
for that workspace.

Token list responses show metadata only. They do not include the raw token or
the stored secret hash. If the raw token is lost, revoke it and create another
one.

Bearer-token callers can use ordinary protected app APIs, table APIs, SQL APIs,
and `GET /api/openapi.json` when their permissions allow it. App-owned report
routes are ordinary protected app APIs. Bearer-token callers cannot create,
list, or revoke other tokens; token management stays a browser-session action.

Auth errors are intended to be actionable:

- `unauthenticated`: no usable session or bearer token was supplied.
- `token_expired`: create a replacement token.
- `token_revoked`: stop using that token.
- `workspace_required`: the token's user no longer belongs to that workspace.
- `forbidden`: the user or token cannot perform that action.

## Auth Context Routes

`GET /api/auth-context` returns the current user, active workspace, active
membership summary, role, and owner boolean.

`POST /api/auth-context/active-workspace` accepts:

```ts
{
  workspaceId: string;
}
```

It verifies membership before updating the active workspace for the session and
returns the same auth context response shape.

Current generated project auth returns the active membership in the
`memberships` array.

`GET /api/auth-tokens` lists the signed-in user's agent access token metadata
for the active workspace.

`POST /api/auth-tokens` creates a token for the signed-in user and active
workspace. The response includes the raw token once.

`DELETE /api/auth-tokens/:id` revokes one active-workspace token.

## Compact Concept Reference

Workspace: the tenant boundary for product data. Generated auth backs this with
a Better Auth organization by default.

Active workspace: the workspace selected on the current session. All
workspace-scoped row predicates use this workspace.

Member: the user's membership record in the active workspace.

Owner: a workspace member whose Sapporta role is `owner`. The starter ability
rules let owners manage generated framework routes by default.

Auth context: the request-local principal, data authority, ability, and
row-security helper.

Principal: who is asking. It may be anonymous or a signed-in user with an active
workspace membership.

Ability: feature-level permission rules. Ability decides whether a handler may
run an action; it does not decide which table rows the handler can touch.

Data authority: the trusted row facts available to a request. The built-in
slots are `systemGlobalOnly`, `workspaceGlobalOnly`, and
`workspaceUserScoped`.

Row scope: table metadata declaring whether rows are user-owned within a
workspace, shared across a workspace, or system-global.

Scope columns: `workspace_id` and, for user-scoped rows,
`scoped_to_user_id`.

Client-managed vs server-managed fields: clients can submit ordinary product
fields; auth scope fields and `clientCanSet: false` references are
server-managed.

Reference visibility: FK values must point to rows visible inside the active
auth boundary.

Framework route: generated Sapporta admin route such as `/api/tables/*`,
`/api/meta/*`, and `/api/openapi.json`.

Product route: custom application route registered by the project under
`/api/*`, including app-owned report routes.

Agent access token: a bearer token for non-browser clients. It names one user
and one workspace, and can call ordinary protected APIs without a browser
session.

## Compact API Reference

`projectAuth.requireAuthContext(c)`: return the resolved request auth context.
Use this only when the route will perform its own authorization and data
authority checks.

`projectAuth.requirePrincipalUser(c)`: require a signed-in user, without
choosing any row authority.

`projectAuth.requireVerifiedUser(c)`: require a verified signed-in user, without
choosing any row authority.

`projectAuth.requireAuthorizedSystemData(c, requirement)`: require the CASL
ability rule and return an auth context narrowed to `systemGlobalOnly` data
authority.

`projectAuth.requireAuthorizedWorkspaceData(c, requirement)`: require the CASL
ability rule and return an auth context narrowed to `workspaceGlobalOnly` data
authority.

`projectAuth.requireAuthorizedWorkspaceUserData(c, requirement)`: require a
signed-in user, require the CASL ability rule, and return an auth context
narrowed to `workspaceUserScoped` data authority.

`projectAuth.requireAuthorizedInteractiveWorkspaceUserData(c, requirement)`:
same as `requireAuthorizedWorkspaceUserData()`, but rejects bearer-token
requests. Use it for browser-session-only workflows such as token management.

`projectAuth.requireWorkspaceRowsAllowed(c)`: require an auth context that has
workspace-global row authority. Prefer the `requireAuthorized*Data()` helpers
for product route code because they also check ability and narrow row security.

`projectAuth.requireWorkspaceOwner(c)`: use for owner/admin workflows. Generated
templates keep it available for app-specific owner checks, but generated table
routes authorize with `auth.ability` and still use data authority for rows.

`scopedRows(db, auth, tableDef)`: default API for ordinary row-scoped table
operations. It binds the request auth context to one table via
`auth.rowSecurity.forTable(tableDef)`.

`rows.list(query?)`: list visible rows with filters, search, sort, pagination,
and total count.

`rows.get(id)`: get one visible row by primary key.

`rows.create(input)`: create one row or a batch of rows after payload policy,
reference visibility, trusted scope stamping, and validation.

`rows.update(id, patch)`: update one visible row by primary key.

`rows.delete(id)`: delete one visible row by primary key.

`rows.lookup(query?)`, `rows.count(query?)`, `rows.exportRows(query?)`: support
generated lookup, count, and export behavior inside the same row boundary.

`auth.rowSecurity.forTable(tableDef)`: create a guard for one table. Use a
separate guard for every table touched by an advanced Drizzle workflow.

`guard.ownedRows(predicate?)`: return the SQL row-access predicate, optionally
AND-composed with another predicate.

`guard.insertValues(db, input, options?)`: prepare one client create payload by
checking payload policy, merging trusted server values, validating references,
and stamping scope fields.

`guard.insertManyValues(db, inputs, options?)`: prepare many create payloads
with the same policy. Empty batches are rejected.

`guard.patchValues(db, patch)`: prepare an update patch by rejecting
server-managed fields and validating submitted references.

`guard.validateReferences(db, payload)`: low-level FK visibility validation for
trusted payloads.

`guard.ensureOwnership(input)`: low-level helper that rejects client-submitted
ownership fields. Prefer `insertValues()` or `patchValues()` for normal write
paths because they also enforce reference policy.

`guard.addOwnershipFields(input)`: low-level helper that stamps trusted
ownership fields on an already-safe object. Prefer `insertValues()` for normal
client create bodies.

`requestDataAuthority(rowAuthorities)`: build a request data-authority record
from one or more atomic row-authority slots. The helper rejects conflicting
workspace ids.

`systemGlobalOnlyAuthority()`: create the authority slot for `systemGlobal`
tables.

`workspaceGlobalOnlyAuthority(workspace)`: create the authority slot for
`workspaceGlobal` tables in one workspace.

`workspaceUserScopedAuthority({ workspace, user })`: create the authority slot
for `workspaceUserScoped` rows owned by one user in one workspace.

`workspaceUserRows(dataAuthority, table)`: predicate for
`workspaceUserScoped` rows owned by the authority's user in the authority's
workspace.

`workspaceRows(dataAuthority, table)`: predicate for `workspaceGlobal` rows in
the authority's workspace.

`systemRows(dataAuthority, table)`: predicate for `systemGlobal` rows.

`selectRowAccessPredicate(dataAuthority, table)`: choose the right predicate
from a table's row scope.

`lookupRowAccessPredicate(dataAuthority, targetTable)`: choose the target-row
predicate used by lookup/autocomplete and FK validation.

`validateForeignKeyReferences(db, dataAuthority, sourceTable, payload, tables,
options?)`: low-level FK visibility check. Use table guards for ordinary route
code; use this only when composing lower-level auth workflows.

## Verification Checklist

Reusable auth test fixtures should include a verified owner, a verified
non-owner workspace user, an unverified user, a user with multiple workspaces,
rows in multiple workspaces, user-scoped rows for multiple users in one
workspace, and visible/invisible FK target rows.

- Routes reject unauthenticated users.
- Product app routes reject unverified and missing-workspace requests according
  to project auth policy.
- Product routes use the narrowest `requireAuthorized*Data()` helper for the
  workflow.
- Framework routes check `auth.ability` for the generated table action before
  calling `scopedRows()`.
- Non-owner users cannot perform owner-only actions unless the project changes
  ability rules intentionally.
- Public Better Auth routes remain reachable.
- Public product routes still check ability and use row security before reading
  table-backed data.
- User-scoped rows are invisible to other users in the same workspace.
- Workspace rows are invisible across workspaces.
- Clients cannot submit `workspace_id` or `scoped_to_user_id`.
- FK values must be visible in the active auth boundary.
- Master-detail insertion propagates trusted scope columns.
- Updates and deletes never use primary key alone.
- Lists, lookups, counts, exports, and pagination do not use post-fetch
  filtering.
- Built-in handlers do not hand-write ad hoc `workspace_id = ?` snippets.
- Tables do not rely on missing `rowScope`, inferred row scope from column
  presence, or ambiguous FK authorization.
- Credentialed CORS does not use wildcard origins.
- Agent access tokens are shown only once, can be revoked, are scoped to one
  workspace, and cannot manage other tokens.
- Interactive-only routes reject bearer-token requests.
- Boot does not mutate schema at runtime.
- Workspace ownership is not treated as global cross-workspace authorization.
- Generated table routes and custom routes use `scopedRows()` for ordinary
  table operations.

Before release, run the full repository verification:

```text
pnpm typecheck
pnpm test
pnpm -r build
pnpm check:public-declarations
pnpm check:peer-singletons
pnpm check:peer-compat:lock
pnpm check:scaffold-bundle
pnpm test:e2e
```
