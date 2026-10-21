---
"@sapporta/frontend": minor
---

`LookupPicker` keeps a table's row display when you customize it.

- `itemDisplay` now draws options over the table's label slot instead of
  turning it off. Its `component` receives `defaultContent`, the option as the
  label slot draws it, to wrap or replace; the chosen value keeps its caption.
- `selectedCaption: "below"` draws the chosen row's caption on its own line
  under the field, at full width, instead of inside the field at its end. The
  line is kept while empty, so picking a value moves nothing.
