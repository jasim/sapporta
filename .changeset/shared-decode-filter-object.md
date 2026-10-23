---
"@sapporta/shared": minor
"@sapporta/server": minor
"@sapporta/frontend": patch
---

`decodeFilterObject()` parses filter conditions written as a JSON object, such
as `{ "amount": { "gte": 100 } }`, into `NewFilterCondition[]`. It rejects an
array on a scalar operator and `null` on any operator but `is`.

An `in`/`nin` item can now contain a comma. Inside an item, `\,` stands for a
comma and `\\` for a backslash, so `filter[terms][in]=Net 30\, EOM,Net 60`
matches two options. `encodeFilters()` writes these escapes, and the server
reads them. A comma inside an item used to split it in two, so the filter
returned the wrong rows. A backslash before any other character is now a
`bad_value`, so an item containing a backslash must be written as `\\`.

`encodeFilters()` and `encodeFilterValue()` now accept conditions without an
`id`, and throw `FilterParseError` for an empty `in`/`nin` list or item, which
the server would reject. `wireKey()`, and so `encodeFilters()`, throws for an
empty column name or one containing `]`, which the key cannot carry.
`materializeFilterCondition()` is removed; it had no callers.

A lookup narrowing's `filter` is encoded by `encodeFilters()`.

The CLI's `--where` and `--fixed` flags use `decodeFilterObject()`, so
`sapporta rows list` and `sapporta rows count` reject those filters before
sending the request. Use `{ "is": null }` to match a missing value;
`{ "eq": null }` used to compare a text column against the string `"null"`.
A list operator now needs a JSON array: `{ "in": "a,b" }` is rejected. The
CLI no longer drops query parameters with an empty value, so
`{ "name": { "eq": "" } }` matches empty text instead of being ignored.

`sapporta api get|post|put|delete --query` now rejects array and `null`
values instead of joining an array with commas and sending `null` as the
string `"null"`. Write a list in the form the endpoint expects, such as
`{ "fields": "a,b" }`. Empty strings in `--query` are now sent as well.

The filter editor's tag input splits pasted text such as `a, b` on commas, the
same as typing a comma between the two.
