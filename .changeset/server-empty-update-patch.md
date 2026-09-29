---
"@sapporta/server": patch
---

`scopedRows().update()` rejects a patch with no fields with a
`ValidationError`, so `PUT /api/tables/<table>/<id>` with `{}` answers with
422 `VALIDATION_FAILED` ("Expected at least one field to update") instead of
a 500 from the database layer.
