# Count Queries

Use an application-owned report when it already defines the business meaning
of a question. For ad hoc counts over one table, use the scoped count endpoint
or `rows count`. Both apply the same authorization, row visibility, and typed
filters as generated table reads.

Sapporta does not decide that a word such as "pending" means
`status != "done"`. Inspect the table metadata or an application-owned report,
choose the intended filter, and state that interpretation with the result.

## CLI

Count visible tasks whose status is not `done`:

```bash
pnpm exec sapporta --output json rows count tasks \
  --where '{"status":{"neq":"done"}}'
```

Group matching tasks by assignee. The ordinary `is` filter excludes the null
group:

```bash
pnpm exec sapporta --output json rows count tasks \
  --where '{"status":{"neq":"done"},"assignee_id":{"is":"notnull"}}' \
  --group-by assignee_id \
  --order desc \
  --limit 10
```

## HTTP

```text
GET /api/tables/tasks/_count
  ?filter[status][neq]=done
  &filter[assignee_id][is]=notnull
  &group_by=assignee_id
  &order=desc
  &limit=10
```

Without `group_by`, the response contains one scalar total:

```json
{ "data": { "kind": "total", "count": 8 } }
```

Grouped counts return typed keys:

```json
{
  "data": {
    "kind": "grouped",
    "groups": [
      { "value": 1, "count": 2 },
      { "value": 2, "count": 2 }
    ]
  }
}
```

Grouped results default to descending count order and a 50-group limit. Use
`order=asc|desc` and `limit` to choose a bounded result. The maximum limit is
1,000 groups.

Null is an ordinary group value. Include or exclude it with the canonical
`filter[group_column][is]=null|notnull` filter.

Count queries return keys, not labels. When a grouped key is a foreign key,
resolve the returned values through the target table's lookup endpoint. That
separate request applies the target table's own authorization and row scope.

Inspect `GET /api/meta/tables/<table>` for column kinds, declared values, and
foreign keys. Inspect `GET /api/tables/{tableName}/_count` with
`endpoints show` for count options.

Do not retrieve complete rows to answer a count question. If a report or the
single-table count endpoint cannot express the required meaning, add an
application-owned report or domain endpoint.
