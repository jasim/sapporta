# Grid runtime

The runtime turns a static grid schema and a hierarchy of data sources into a
live grid. It is a plain TypeScript object. React reads it through external
store subscriptions, but the runtime does not depend on React.

Start with `GridRuntime`. It represents the whole running grid. A
`GridLevelRuntime` represents one registered `GridPath`. Most application code
works with a level because rows, selection, drafts, expansion, and writes all
belong to a path.

## The runtime model

A grid schema describes level names and their parent-child relationships. A
`GridPath` identifies one occurrence of a level in the live hierarchy. The root
path contains only the root level name. Each child step adds the parent row key
and the child level name.

For example:

```text
orders
orders.ord-1.lines
orders.ord-1.lines.line-4.notes
```

The schema is static. Paths are dynamic. Expanding `ord-1` can register the
`orders.ord-1.lines` path. The same `lines` schema can appear at a different
path under another order.

Each registered path has four relevant resources:

- A source publishes data and loading state.
- A displayed-row store turns source rows and drafts into the rows the grid
  can render and navigate.
- A controller stores path-local interaction state such as cell selection,
  row selection, focus mirrors, and editing.
- A `GridLevelRuntime` provides the path-bound read, command, and subscription
  surface.

The coordinator belongs to the whole runtime. It stores cross-path state such
as the global cursor and expansion. The cursor manager updates the global
cursor and the matching path-local focus mirror together.

## Construction

`createGridRuntime` performs these steps in order:

1. It snapshots and validates the schema and interaction configuration.
2. It installs the initial host event listeners. They can observe the first
   runtime transition.
3. It creates the source registry, draft lifecycle, displayed-row runtime, and
   mutation boundary.
4. It acquires and registers the root source, then creates the root
   `GridLevelRuntime`.
5. It creates the coordinator, cursor manager, interaction runtime,
   boundary-loading runtime, and row-operation controller.
6. It binds the complete internal graph and returns the public runtime.

Construction either produces a complete runtime or disposes every resource it
already acquired. A caller never receives a partly constructed runtime.

The runtime snapshots the schema. Replacing or mutating the caller's schema
object does not reconfigure a running runtime. Create a new runtime for a new
schema.

## Path registration

The source registry is the authority for which paths currently exist.
`runtime.registeredLevels()` is a path-bound view of the same registry.

The root path is registered eagerly. Child paths are registered when their
parent row is first expanded. Registration happens before the coordinator
publishes the expanded state. A subscriber that observes the expansion can
therefore resolve every declared child level immediately.

One expansion registers child levels in schema declaration order. The same
order is used when children render and when visible-order navigation walks the
grid.

Collapsing a row does not unregister its child paths. Their sources,
controllers, and interaction state remain available for a later expansion.
Removing the parent row is different. It unregisters the entire descendant
subtree from deepest path to shallowest path.

Each registration receives an opaque `LevelHandle`. A path can be removed and
later registered again. The new registration receives a new handle. Old level
objects and subscriptions therefore cannot start reading the new resource by
accident.

## A source notification

A `LevelDataSource` must publish its new state through `state()` before it
notifies subscribers. The runtime then processes the notification in this
order:

1. The registry snapshots the source state and preserves stable object
   identities where the source data is unchanged.
2. The registry checks that row keys are unique. An identity failure becomes a
   source error state and disables writes for that path.
3. The registry updates row membership generations. Row operation targets use
   these generations to reject stale targets.
4. Completed row removals collapse the removed row and unregister its
   descendants.
5. The draft lifecycle removes blank append drafts that are no longer eligible
   and creates the blank first-row draft when an empty writable level allows
   one.
6. An existing displayed-row store derives the next read model. A path with no
   displayed-row store waits and derives from current state on its first read.
7. Independent row selection is normalized before displayed-row subscribers
   run. A subscriber therefore observes selection that matches the new rows.
8. A pending loaded-boundary navigation may land on the newly loaded edge.
9. The runtime emits `levelStatusChanged` when the status changed.
10. `level.data` subscribers run after the runtime has finished the preceding
    bookkeeping.

This ordering is part of the runtime contract. A listener can re-read related
runtime state without seeing an intermediate source transition.

## Displayed rows

Source snapshots contain source-backed nodes and optional footers. Draft rows
live in a separate phantom channel. The displayed-row store combines those
inputs with the level schema and derives the complete row read model.

The store exposes two similar subscription levels because the consumers have
different work to do:

- `subscribeDisplayedRowSequence` observes the ordered `{ id, kind }` list. It
  is useful for code that mounts, removes, or reorders row shells. A cell value
  change does not wake it when the row order and kinds stay the same.
- `subscribeDisplayedRow(rowId, listener)` observes one `LevelRow`. It is
  useful for a row renderer or a consumer that reads that row's cells. It wakes
  only when that row object changes.

`displayedRows()` returns the complete imperative read model, including lookup
maps. Interaction and navigation use it when they need a coherent snapshot of
the whole level. It is a read, not a subscription.

The displayed-row store runs row-selection normalization before notifying
either displayed-row subscription. This prevents a render from observing a
selection that still names a removed or hidden row.

## Interaction subscriptions

Interaction has several projections over related state. Each projection has a
separate subscription because it answers a different application question.

- `level.subscribeActiveRow` answers which row currently drives active-row
  behavior on one path. It follows the cell cursor in configured cell grids and
  the row cursor in row lists.
- `runtime.subscribeActiveRow` observes the one global active-row snapshot. The
  snapshot contains the live `level` and displayed `row`. `level.path` locates
  the row and `row.id` is its identity, so the subscription also wakes when the
  current row's displayed values change.
- `subscribeSelectedRows` observes the selection value. That value can be
  disabled, derived from the active row, or stored independently.
- `subscribeSelectedRowIds` observes the selected rows after projecting the
  selection through the current displayed order. It also wakes when displayed
  rows change and that projection changes.
- `subscribeRowInteractionSnapshot` combines the active row and projected
  selected row ids into per-row statuses. It is useful when one consumer needs
  all row interaction decoration from one coherent read.

These subscriptions compare their derived snapshots before notifying. A
change in an underlying controller or coordinator does not wake a listener
when that listener's projection is unchanged.

Cell selection and row selection are separate domains. A cell range identifies
cells for editing and copy behavior. Row selection identifies row operation
targets. A command can change one without moving or changing the other.

Row activation is an optional semantic command on an enabled active-row
configuration. Omission disables it. In cell-grid mode, Enter edits the focused
cell when its source, displayed row, and column are all editable. Otherwise it
runs the cell activation, then falls back to row activation. Space runs a
declared cell activation, including row expansion, while Shift+Space toggles an
independent row selection. In row-list mode, Space toggles expansion and Enter
runs row activation when configured. A configuration cannot assign both click
and double-click to row activation because browsers deliver click events before
`dblclick`.

`runtime.activeRow()` and `runtime.subscribeActiveRow()` expose grid-wide
current state. The level interaction reads and subscriptions expose current
state for one path. React renders the grid-wide snapshot through
`useGridActiveRow(runtime)` in a provider-owning component or
`useGridActiveRow()` in a provider descendant.

## Other subscription surfaces

`runtime.subscribeLevels(listener)` observes changes to the set of registered
levels. It wakes when paths are added or removed. Source loading, row changes,
selection, and expansion without new registration do not wake it.

`level.data.subscribe(listener)` observes the source state for one level. It is
useful for loading and error UI and for code that reads query state. It does not
mean that displayed row order or interaction state changed.

`level.drafts.subscribe(listener)` observes draft authoring state for one path.
Drafts do not enter the source until `commit` succeeds.

`level.subscribeExpansion(listener)` observes the expansion set for that path.
It does not wake for expansion changes in another path.

The advanced controller subscription observes the complete path-local
controller state. Its `effects` subscription observes queued imperative work
such as focus and reveal requests. These are separate because controller state
can change without scheduling DOM work, and DOM work can remain queued while a
collapsed level is not mounted.

`RuntimeArgs.on` installs construction-time event listeners before the root
source is acquired. `runtime.on(event, listener)` installs listeners during the
runtime lifetime. Runtime disposal clears both listener sets.

Events describe discrete commands, outcomes, and defined transitions. They are
separate from current-state subscriptions:

- `cellSelectionChanged` reports a transition in the controller's stored cell
  selection.
- `rowSelectionChanged` reports a transition in the controller's stored row
  selection. Derived `selectedRows()`, `selectedRowIds()`, and
  `rowInteractionSnapshot()` values can also change when the active row or
  displayed rows change.
- `levelStatusChanged` reports each source status transition observed by the
  runtime. Source data changes with the same status do not produce this event.
- `rowActivated` reports every successful configured row activation. Repeated
  activation of the same active row produces repeated events.

Host events are not render invalidations. Source-internal refreshes can change
displayed data without emitting `mutationCommitted`.

Every subscription returns an idempotent unsubscribe function. A level tracks
subscriptions created through its public surface and releases them when that
registration ends. Runtime disposal clears all remaining subscriptions.
Observer errors are reported through `onObserverError`; one observer cannot
interrupt the state transition or prevent later observers from running.

## Writes and drafts

All application writes pass through the runtime. A level exposes
`writeCell`, `applyChanges`, `createRow`, and `removeRow`. The source view on
`level.data` exposes query and reconciliation capabilities but hides concrete
write verbs.

`writeCell` validates the displayed row kind. A source-backed data row delegates
to the source and emits `mutationCommitted`. A draft row updates the phantom
channel and does not emit a source mutation event.

`applyChanges` sends one batch to one path and emits one mutation event. The
source owns the batch's atomicity.

`createRow` validates the proposed row before calling the source. It then
validates the authoritative row returned by the source. An invalid
authoritative identity faults the runtime because later path and row lookups
would no longer be trustworthy.

Drafts have `editing`, `saving`, and `failed` states. Leaving a non-blank
editing draft starts a commit. Repeated commits for the same path and row key
share one pending promise. A successful commit removes the draft after the
source row is created. A failed commit keeps the draft and records the failure
reason. Editing a failed draft returns it to `editing`.

## Row operations and removal order

`runtime.rowOperations.targets()` chooses operation targets from each
registered path. Explicit row selection takes precedence. A path with no row
selection can contribute rows covered by its cell selection.

`selectedDataTargets()` returns only source-backed data rows selected through
the row-selection domain. Use it for commands that must not fall back to cell
selection.

Targets are capabilities issued by one runtime registration. The runtime
records the row's membership generation when it creates a target. Removal
rejects a target when the row disappeared, returned with the same key, moved to
another registration, or came from another runtime.

Multi-row removal runs descendants before ancestors. Within the same depth it
uses registry order, displayed-row order, and caller order as deterministic
tie-breakers. This keeps child sources available while their child rows are
removed.

The runtime plans cursor continuation before the first removal. It moves focus
away from rows that are expected to disappear. After the source operations
settle, it corrects the cursor only when the current target is invalid. A user
cursor move made during an asynchronous removal takes precedence when it still
points to a valid row.

A failure stops the sequence. The result identifies removed, failed, and
unattempted targets. The runtime waits for touched paths to settle before it
returns the result.

## Loaded boundaries

Navigation can reach the edge of the currently loaded rows. The optional
`onLoadedRowsBoundary` callback lets the host load more data. The runtime keeps
one pending boundary intent. An identical repeated request reuses it. A newer
different request supersedes the earlier landing.

The source command promise must settle after the source has published its
state. A ready result makes the runtime sample the new displayed rows and move
to the requested edge. Loading and error states do not produce a landing.

## Disposal

`runtime.dispose()` is idempotent. It first makes the runtime and every level
unavailable to new reads, commands, and notifications. It then releases
level-bound subscriptions, displayed-row stores, controllers, pending boundary
intent, host event listeners, and registry listeners.

Async source operations that already started are allowed to settle. The
runtime suppresses their host events after disposal. Source objects, the draft
channel, and the parent `GridDataSource` are disposed after the final active
operation settles. This prevents an in-flight source promise from running
against a dependency that was disposed underneath it.

Static values on an old `GridLevelRuntime`, such as `path` and `schema`, remain
readable. Dynamic reads and commands fail after that level registration ends.

## Module guide

- `runtime.ts` assembles the runtime and defines the ordering between parts.
- `source-registry.ts` owns source registrations, source-state snapshots,
  row-membership generations, and registration cleanup.
- `grid-level-runtime.ts` creates the path-bound public API and tracks its
  subscriptions.
- `displayed-rows.ts` owns one displayed-row store per path.
- `interaction-runtime.ts` owns controllers and memoized interaction
  projections per path.
- `mutations.ts` is the source write boundary.
- `drafts.ts` owns explicit draft commands and pending draft commits.
- `phantom-row-lifecycle.ts` owns automatic append-draft behavior.
- `row-operations.ts` validates operation targets and orders row removals.
- `loaded-boundary.ts` resumes navigation after a host-owned load.
- `emitter.ts` delivers typed host events.
