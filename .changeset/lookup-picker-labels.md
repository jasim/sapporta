---
"@sapporta/frontend": minor
---

`LookupPicker` takes `labels`, for wording in the application's own terms:
the clear and open buttons' names, the empty list, a tree picker's loading,
too-large and failed messages, and the note after the row being edited, such
as `{ clear: "Make it a top-level account", editing: "(this account)" }`.
Each label left out keeps Sapporta's default, listed in
`DEFAULT_LOOKUP_PICKER_LABELS`.

A tree picker passes the edited row's note to the table's label slot as
`DisplayContext.editingNote`, so a slot that draws its own content can use
the picker's wording. The note is now read as a separate word.
