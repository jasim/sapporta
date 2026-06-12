# Scoped Report Data

Report routes use normal route authorization and normal scoped data access.

```ts
api.register("incomeStatement", incomeStatementRoute, async ({ c, request }) => {
  const auth = c.get("auth");
  auth.requireAuthenticated();
  auth.requireCan("read", "reports:income-statement");

  const rows = await readIncomeStatementRows({
    db: c.get("db"),
    auth,
    input: request.query,
  });

  return { status: 200, body: toIncomeStatementResult(rows) };
});
```

Keep handlers thin:

- Resolve auth and request input in the route handler.
- Read rows in a data function that receives `auth` explicitly.
- Map rows to `GridReportResult` in a pure function.

For Drizzle reads, compose the table's row-security predicate:

```ts
const accountAccess = auth.rowSecurity.forTable(accounts);

const rows = await db
  .select()
  .from(accounts.drizzle)
  .where(accountAccess.ownedRows());
```

For raw SQL, make visible base tables explicit with CTEs before composing the
report query. Do not accept workspace or user scope from client parameters.
