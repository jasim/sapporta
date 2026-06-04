# Sapporta Auth: Building Row-Safe Apps With Workspaces

Sapporta projects start with an auth-ready application structure. You get
email/password sign-in, Better Auth API routes, session-backed request auth,
workspace provisioning, active workspace selection, role resolution, route
guards, frontend auth context APIs, and row-scoped generated table APIs.

The main rule is simple: row ownership lives in the database, but clients do not
get to choose it. A signed-in request resolves to an active workspace, a user,
and a membership role. The standard table API is `scopedRows(db, auth, table)`.
It uses that request auth context to stamp trusted scope columns on inserts and
to add SQL predicates to reads, updates, deletes, lookups, exports, and counts.

## What You Get In A New Sapporta Project

A new Sapporta project includes:

- Better Auth configured as the default sign-in system.
- Email/password auth pages and `/api/auth/*` routes.
- Session-backed auth middleware for API requests.
- First-workspace provisioning.
- Active workspace selection.
- Owner/user role resolution.
- Route guards for product routes and framework/admin routes.
- Frontend auth context APIs and an `AuthGate`.
- Generated table operations that protect rows by workspace and user scope.

For ordinary table work, use the row-scoped table API exported by
`@sapporta/server`:

```ts
const auth = projectAuth.requireWorkspaceUser(c);
const rows = scopedRows(c.get("db"), auth, invoices);
```

Generated `/api/tables/*` routes use the same API. Use it in custom product
routes for ordinary list, get, create, update, delete, lookup, count, and export
work. When a route needs a custom Drizzle workflow, such as joins,
transactions, aggregates, or domain-specific invariants, use the lower-level
row-security primitives described later in this guide.

- If you use generated table routes, Sapporta applies row protection for you.
- If you write ordinary custom table operations, start with
  `scopedRows(db, auth, table)`.
- If you write advanced Drizzle workflows, use the lower-level row-security
  primitives explicitly.
- You still own and can edit the project auth code copied into
  `packages/api/project-auth`.

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
own invoices, but `scopedRows(db, auth, invoices)` still only sees rows visible
to that owner as the authenticated user. It does not become an "all cashiers'
invoices" query just because the route required `requireWorkspaceOwner(c)`.

For user-owned invoices:

```ts
meta: { rowScope: "workspaceUserScoped" }
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
  customer_id: integer("customer_id").notNull(),
  total: integer("total").notNull(),
  status: text("status").notNull(),
});

export const invoices = table({
  drizzle: invoicesTable,
  meta: {
    label: "Invoices",
    rowScope: "workspaceUserScoped",
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
6. Creates project auth from Better Auth config and the loaded catalog.
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

The generated guard helpers all read the already-resolved `c.get("auth")`:

- `requireOnlyBareLoggedInUser(c)`
- `requireOnlyBareVerifiedUser(c)`
- `requireWorkspaceUser(c)`
- `requireWorkspaceOwner(c)`

## Project Auth Files

The source template for generated project auth lives in
`packages/core/src/templates/project-auth`. `sapporta init` copies it once into
local project code:

```txt
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
```

Generated projects own those files. They may customize workspace provisioning,
role mapping, middleware behavior, guard policy, error responses, and auth
routes without changing `@sapporta/server`.

- `env.ts`: parses auth secrets, API base URL, frontend origins, email
  behavior, and health policy.
- `better-auth.ts`: creates the Better Auth instance with email/password and
  the organization plugin.
- `schema.ts`: defines the Better Auth Drizzle schema.
- `context.ts`: converts the Better Auth session and organization membership
  into `SapportaAuthContext`.
- `workspace.ts`: handles membership lookup, active workspace selection,
  initial workspace provisioning, workspace switching, and role mapping.
- `routes.ts`: implements `GET /api/auth-context` and
  `POST /api/auth-context/active-workspace`.
- `middleware.ts`: installs request auth resolution, public route skipping,
  verified-email policy, and project-owned route guards.
- `errors.ts`: defines project auth JSON error responses.

Generated migrations create Better Auth tables and product tables before the
app serves requests. Boot checks migration readiness only; it must not mutate
schema at runtime.

## Sign Up And Resolve Auth Context

On first login, Better Auth creates or reads the session. Project auth resolves
the active workspace. If the user has no workspace membership yet, the generated
project auth code provisions an initial workspace and owner membership. Better
Auth organization membership roles are mapped into Sapporta roles:
`owner`/`admin` become `owner`; everything else becomes `user`.

The request receives a `SapportaAuthContext`:

```ts
interface SapportaAuthContext {
  session: { id: string; userId: string; activeWorkspaceId: string };
  user: { id: string; name: string | null; email: string; emailVerified: boolean };
  workspace: { id: string; name: string; slug: string; isOwner: boolean };
  member: { id: string; role: "owner" | "user" };
  rowSecurity: RowSecurity;
}
```

That `rowSecurity` object is bound to the request identity and loaded table
catalog.

## Protect Product Routes

Generated framework routes are owner-gated by default. Product/domain routes
should usually require a workspace user and then use `scopedRows()` for
ordinary table work.

```ts
import { scopedRows } from "@sapporta/server";

api.register("createInvoice", contract.createInvoice, async ({ c, request }) => {
  const db = c.get("db");
  const auth = projectAuth.requireWorkspaceUser(c);
  const rows = scopedRows(db, auth, invoices);

  const created = await rows.create(request.body);
  return { status: 201, body: { data: created } };
});
```

`projectAuth.requireWorkspaceUser(c)` authenticates the request and guarantees
an active workspace membership. `scopedRows(db, auth, invoices)` is the
trust-boundary constructor for ordinary table operations. It binds that request
auth context to one table and internally uses `auth.rowSecurity.forTable(table)`.

Client-provided `workspace_id` or `scoped_to_user_id` is rejected. Trusted scope
values are inserted from auth. Reads, updates, deletes, lookups, counts, and
exports are all scoped by the same auth context.

## Default: Use `scopedRows()`

Use `scopedRows()` when the route is doing normal table work: list rows, get one
row, create rows, update a row, delete a row, power a lookup, count child rows,
or export rows. This is the path generated `/api/tables/*` routes use.

```ts
api.register("listMyInvoices", contract.listMyInvoices, async ({ c, request }) => {
  const db = c.get("db");
  const auth = projectAuth.requireWorkspaceUser(c);
  const rows = scopedRows(db, auth, invoices);

  const result = await rows.list(request.query);
  return { status: 200, body: result };
});

api.register("getInvoice", contract.getInvoice, async ({ c, request }) => {
  const auth = projectAuth.requireWorkspaceUser(c);
  const rows = scopedRows(c.get("db"), auth, invoices);

  const invoice = await rows.get(request.params.id);
  return { status: 200, body: { data: invoice } };
});

api.register("voidInvoice", contract.voidInvoice, async ({ c, request }) => {
  const auth = projectAuth.requireWorkspaceUser(c);
  const rows = scopedRows(c.get("db"), auth, invoices);

  const invoice = await rows.update(request.params.id, { status: "void" });
  return { status: 200, body: { data: invoice } };
});

api.register("deleteInvoice", contract.deleteInvoice, async ({ c, request }) => {
  const auth = projectAuth.requireWorkspaceUser(c);
  const rows = scopedRows(c.get("db"), auth, invoices);

  const deleted = await rows.delete(request.params.id);
  return { status: 200, body: { data: deleted } };
});
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
const auth = projectAuth.requireWorkspaceUser(c);
const invoiceGuard = auth.rowSecurity.forTable(invoices);
const lineGuard = auth.rowSecurity.forTable(invoiceLines);
```

Use one guard per table because each table has its own row scope and reference
rules.

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
  const auth = projectAuth.requireWorkspaceUser(c);
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
  quantity: integer("quantity").notNull(),
  line_total: integer("line_total").notNull(),
});

export const invoiceLines = table({
  drizzle: invoiceLinesTable,
  meta: {
    label: "Invoice Lines",
    rowScope: "workspaceUserScoped",
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
    customer_id: z.number(),
    total: z.number(),
    status: z.string(),
  }),
  lines: z.array(
    z.object({
      product_id: z.number(),
      quantity: z.number(),
      line_total: z.number(),
    }),
  ),
});
```

The route inserts the invoice first, then inserts the lines with
`invoice_id` supplied as a trusted server value:

```ts
api.register("createInvoice", contract.createInvoice, async ({ c, request }) => {
  const db = c.get("db");
  const auth = projectAuth.requireWorkspaceUser(c);
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
});
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
customer_id: integer("customer_id").references(() => customersTable.id)
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

Framework table routes are mounted with `projectAuth.requireWorkspaceOwner` in
the generated template. That guard decides whether the route may run; it does
not broaden row visibility. Row visibility still comes only from the resolved
`SapportaAuthContext` passed to `scopedRows()`.

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

## Auth Context Routes

`GET /api/auth-context` returns the current user, active workspace, active
membership summary, role, and owner boolean.

`POST /api/auth-context/active-workspace` accepts:

```ts
{ workspaceId: string }
```

It verifies membership before updating the active workspace for the session and
returns the same auth context response shape.

Current generated project auth returns the active membership in the
`memberships` array.

## Compact Concept Reference

Workspace: the tenant boundary for product data. Generated auth backs this with
a Better Auth organization by default.

Active workspace: the workspace selected on the current session. All
workspace-scoped row predicates use this workspace.

Member: the user's membership record in the active workspace.

Owner: a workspace member whose Sapporta role is `owner`. Owners can access
generated framework routes by default.

Auth context: the request-local session, user, workspace, member, and
row-security helper.

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
`/api/meta/*`, `/api/reports/*`, and `/api/openapi.json`.

Product route: custom application route registered by the project under
`/api/*`.

## Compact API Reference

`projectAuth.requireWorkspaceUser(c)`: use by default for product routes. It
returns the current auth context and requires an active workspace membership.

`projectAuth.requireWorkspaceOwner(c)`: use for owner/admin workflows. Generated
framework routes use this by default.

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

`currentUserRows(auth, table)`: predicate for `workspaceUserScoped` rows owned
by the current user in the active workspace.

`allWorkspaceRows(auth, table)`: predicate for rows in the active workspace.

`allSystemRows(auth, table)`: predicate for `systemGlobal` reference rows.

`selectRowAccessPredicate(auth, table)`: choose the right predicate from a
table's row scope.

`lookupRowAccessPredicate(auth, targetTable)`: choose the target-row
predicate used by lookup/autocomplete and FK validation.

`validateForeignKeyReferences(db, auth, sourceTable, payload, tables, options?)`:
low-level FK visibility check. Use table guards for ordinary route code; use
this only when composing lower-level auth workflows.

## Verification Checklist

Reusable auth test fixtures should include a verified owner, a verified
non-owner workspace user, an unverified user, a user with multiple workspaces,
rows in multiple workspaces, user-scoped rows for multiple users in one
workspace, and visible/invisible FK target rows.

- Routes reject unauthenticated users.
- Product app routes reject unverified and missing-workspace requests according
  to project auth policy.
- Product routes require workspace users.
- Framework routes require workspace owners unless the project changes that
  policy intentionally.
- Non-owner users cannot access framework routes.
- Public Better Auth routes remain reachable.
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
