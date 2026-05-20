// Public surface of the grid module.
//
// =====================================================================
// What this is
// =====================================================================
//
// A hierarchical data grid. Flat tables and multi-level reports are both
// first-class consumers; neither is privileged. The grid is pure-render,
// keyboard-navigable, and cell-editable.
//
// =====================================================================
// The problem it solves
// =====================================================================
//
// React grids naturally re-render O(N×M) cells on every interaction — a
// focus move, a selection change, a scroll. This module's architecture
// guarantees ≤3 cell renders per keystroke on a 100×30 grid: the old
// focus cell, the new focus cell, and occasionally one extra when a
// selection rectangle shifts. Everything else stays idle.
//
// The mechanism: four non-interfering state channels, path-scoped
// displayed-row stores, and a single effect drain. The rest of this
// comment explains how they fit together.
//
// =====================================================================
// Quick start — what a consumer does
// =====================================================================
//
//   import {
//     createGridRuntime, GridRuntimeProvider, GridLevel, rootPath,
//     inMemoryGridDataSource,
//   } from "@/grid";
//
//   const runtime = createGridRuntime({
//     schema,
//     dataSource: inMemoryGridDataSource({ schema, tree, levels }),
//     on: { mutationCommitted, ... },
//   });
//
//   <GridRuntimeProvider runtime={runtime}>
//     <GridLevel path={rootPath(schema.rootLevel)} />
//   </GridRuntimeProvider>
//
// `schema` is a `GridSchema` — column schemas + level options keyed by
// level name, with `rootLevel` and `childLevels` describing the tree's
// shape. Data lives on a `GridDataSource` (in-memory, REST, or custom).
// The runtime is a plain TypeScript value, not a React thing. Components
// reach it via context. Host events (mutationCommitted, selectionChanged,
// cellReconciled, levelStatusChanged, phantomCommitted)
// are wired at construction via `runtime.on(…)`, not through React props —
// see `emitter.ts`.
//
// Reading order:
//   1. index.ts — public API and architecture signpost.
//   2. runtime/create-grid-runtime.ts — runtime construction, source
//      registry, write boundary, and per-path controller wiring.
//   3. data-sources/types.ts — data-source contract and snapshot shape.
//   4. displayed-rows/ — pure `DisplayedRowsInput` → row read models.
//   5. react/GridLevel.tsx — recursive render bridge.
//   6. interaction/controller.ts — selection, focus, editing, and
//      keyboard dispatch.
//
// =====================================================================
// A concrete scenario — what happens when you click a cell
// =====================================================================
//
// 1. The cell's mousedown handler calls `runtime.focusManager.moveTo(...)`
//    for a plain click, or `extendTo(...)` for a shift-click range.
// 2. The focus manager writes the global cursor on the coordinator and
//    the per-path `liveFocus` mirror on the controller, in lockstep.
//    Two cells flip their `status` selector: old focus → "none", new
//    focus → "focus". That's exactly two React re-renders across the
//    entire grid. Cells subscribe only to their own controller's
//    `liveFocus`, so cursor moves in unrelated paths produce zero
//    re-renders here.
// 3. `Grid` subscribes to `cursor?.path === path` and updates its
//    container's `data-active` attribute; cells stay idle and the CSS
//    cascade applies the active/ghost visual treatment. Active-ness is
//    level-scoped, so it lives at level scope on the DOM rather than
//    as a per-cell subscription. If the cursor's path didn't change,
//    the selector returns the same boolean and `Grid` doesn't even
//    re-render.
// 4. The static channel (props / context) is untouched. Schema, level
//    columns, renderers — none of that changes on a click.
//
// The key invariant: a change in one channel never causes subscribers of
// another channel to wake up. That is the whole design in one sentence.
//
// =====================================================================
// The four channels
// =====================================================================
//
// Grid state lives in exactly four channels. Each has its own mechanism
// and lifetime. The channels never invalidate each other, and that is
// the rule the rest of the module is built to enforce.
//
//   1. STATIC — props and context (`GridRuntimeProvider` + a runtime
//      value). Schema, level columns, level options, column
//      renderers/editors, host callbacks. Changes only when the input
//      `GridSchema` is replaced.
//
//   2. TRANSIENT — `GridController`, one Zustand store per `GridPath`
//      (interaction/controller.ts). Selection, focus, editing. This
//      state outlives DOM presence: collapsing and re-expanding a level
//      preserves its focus and selection. Each path's controller is
//      independent — a selection change in path "orders.ord-3.lines" never
//      wakes subscribers in path "orders.ord-4.notes". That is *why*
//      transient is
//      separate from structural: per-level concerns would invalidate
//      unrelated subscribers if they shared a store.
//
//   3. STRUCTURAL — `GridCoordinator`, one Zustand store per runtime
//      (interaction/coordinator.ts). Cross-path concerns: which levels
//      are expanded and the global `cursor` (the active path is
//      `cursor?.path`). Boundary navigation (arrowing past the last
//      row of one level into the first row of the next) is resolved
//      on demand via `nextVisibleRow` and applied through the focus
//      manager — the sole writer of `cursor` and of every controller's
//      `liveFocus`. The coordinator holds no per-mount focus mailbox.
//      Active-ness is structural because it determines whether a level
//      is "live" or "ghost" — a visual distinction that belongs to
//      the grid as a whole, not to any one level. Expansion is
//      structural because it drives which `GridLevel`s mount and how
//      boundary keyboard routing works between them.
//
//      Structural state reaches the DOM at the scope it varies, not the
//      scope it's consumed. Active-ness varies at *level* scope (every
//      cell in a level shares it), so it lives on the grid container as
//      `data-active` and propagates to descendant cells via CSS, with
//      no per-cell subscription.
//
//   4. DATA — `LevelDataSource` (per `GridPath`). Owns nodes,
//      sort/filter/pagination state, server-supplied footers/aggregates,
//      and `loading | error | ready` status. The runtime never owns data;
//      it receives a `GridDataSource` from the host and registers sources
//      as paths are expanded. Sources emit identity-stable snapshots;
//      displayed-row derivation is a pure function of `DisplayedRowsInput`.
//      Seven invariants govern the data plane — see `data-sources/types.ts`.
//
// =====================================================================
// The effects channel
// =====================================================================
//
// A sibling sits next to the controller: `controller.effects`
// (types/effects.ts). Reducers must be pure, but some outcomes need DOM
// work — focusing a cell, scrolling into view, notifying the host. Pure
// reducer outputs flow into this queue; a single `useEffect`
// (react/EffectRunner.tsx) drains it after layout. Without this
// seam, imperative calls would leak into the reducer and break the
// pure-render discipline.
//
// The queue's array identity is preserved across no-op transitions —
// the EffectRunner's subscription only fires when new effects are
// actually queued.
//
// =====================================================================
// Key terms
// =====================================================================
//
//   GridPath    — logical position in a grid forest. Encoded as a
//                 `.`-separated alternation of (levelName, rowKey,
//                 levelName, …, levelName) — e.g. "orders",
//                 "orders.ord-1.lines", "orders.ord-1.lines.ln-2.notes".
//                 (types/identity.ts)
//
//   RowId       — logical row identity: `${GridPath}#${RowKey}`.
//                 Stores key on RowId; array indices are render-time
//                 scratch. Reordering rows does not move identity.
//                 (types/identity.ts)
//
//   Coord       — { rowId: RowId; colId: ColId }. Identifies one cell.
//                 (types/identity.ts)
//
//   SchemaTopology
//               — the static name graph derived from a `GridSchema`:
//                 levels, their columns, and parent/child relations by
//                 name. Built once per runtime.
//                 (schema/schema-topology.ts)
//
//   Visible order — the lazy view that names "what comes next under
//                 the cursor." Read on demand from `displayed.rows`,
//                 `coordinator.expansion`, schema-declared child levels,
//                 and the runtime's source registry. There is no
//                 cached projection: render and `visible-order.ts`
//                 read the same live inputs and so cannot disagree.
//                 (interaction/visible-order.ts)
//
//   DisplayedRowSequence
//               — ordered `{ id, kind }` row references for one path. The
//                 body subscribes to this so cell-content edits do not remap
//                 the list of row shells.
//                 (displayed-rows/, types/level-row.ts)
//
//   DisplayedRows
//               — the full row-content snapshot for one path: ordered
//                 `LevelRow` objects plus lookup maps. Interaction and
//                 navigation use this imperative read model; row React
//                 subscribers read one `LevelRow` by id. No component reads
//                 `LevelSnapshot.nodes` directly.
//                 (displayed-rows/)
//
//   LevelRow    — uniform row shape regardless of source kind (data,
//                 rollup, footer, phantom, bracket). Renderers and the
//                 interaction layer branch on `capabilitiesFor(kind)`,
//                 not on `kind` directly.
//                 (types/level-row.ts, types/capabilities.ts)
//
// =====================================================================
// Render discipline
// =====================================================================
//
// Every component is a pure function of (static props, store-slice
// subscriptions). The codebase enforces this by exclusion — each rule
// exists because violating it breaks the ≤3-renders guarantee:
//
//   - No `useState` over data. The runtime exposes external stores for what
//     you'd otherwise memoize (displayed rows, schema, topology). `useState`
//     would create a second source of truth that drifts from the store.
//     (CellEditorOverlay's `useState` measures DOM geometry only —
//     local to the overlay, not grid state.)
//
//   - No `useMemo` / `useCallback` over data. The runtime returns
//     identity-stable values; selectors are inline. Zustand's equality
//     bailout keeps subscribers idle on no-op transitions without
//     needing memoized selector references.
//
//   - One `useEffect` over data: `EffectRunner`, draining the effects
//     channel. The single `useEffect` in `Grid.tsx` is for DOM wiring
//     only — a native keydown listener guarded so only the innermost
//     grid containing the event target acts. Any `useEffect` over data
//     would mean the component has a second path to update, breaking
//     the "subscribe to store, re-render on change" contract.
//
//   - One `React.memo`: `GridRow`. Structurally justified — the parent passes
//     stable row identity props, while row data arrives through
//     `useDisplayedRow`. A row only re-renders when its own inputs change.
//     Selection flips inside the row hit `GridDataCell`'s store subscriptions
//     directly; they never bubble through `GridRow`.
//
//   - Cells are stateless views. Neither the renderer nor the cell
//     component reads active-ness. Active/ghost is level-scoped and
//     reaches the DOM only via `Grid`'s container `data-active`
//     attribute, consumed by CSS — flipping the active path produces
//     zero cell re-renders (the selector flip wakes only `Grid` and
//     `DisplayedRowsBody`; `GridRow`'s memo blocks the cascade). Renderers also
//     do not read focus, selection, or editing — `CellShell` handles
//     all visual chrome. A click that moves focus causes exactly two
//     cell re-renders (status selector flips) regardless of grid size.
//     The renderer's output is identical across focus flips — React
//     diff produces zero DOM mutations; the only cost is one JS
//     function call.
//
// =====================================================================
// Orchestration
// =====================================================================
//
// `GridRuntime` (runtime/create-grid-runtime.ts) is a plain TypeScript value, not a
// React thing. It owns the schema/path topologies, the per-path displayed-row
// stores, the controller instances, and the seams through which all data writes
// flow (`writeCell`, `applyChanges`, `commitPhantom`) — each resolves the
// path's `LevelDataSource` and forwards. Components reach it via
// `useGridRuntime()`.
//
// Because the runtime exposes displayed rows through identity-stable external
// stores, components never need to compute derived data in render bodies. This
// is what makes the no-`useMemo` rule realistic: the things you would memoize
// are already owned by the runtime.
//
// The displayed-rows store is the only source of body render input. No
// component reads `LevelSnapshot.nodes` directly. Derivation stages are pure;
// the store invalidates only on source, phantom, or future view-state changes,
// then notifies sequence subscribers from `DisplayedRowSequence` identity and
// row subscribers from individual `LevelRow` identity.
//
// =====================================================================
// Success metrics
// =====================================================================
//
// `cellRenders` counter per arrow press, with a 100×30 grid:
//
//   - Target: ≤3 cell renders per move — old focus, new focus, and one
//     extra when a selection-extension crosses a bounding-box boundary.
//   - Active-path flip re-renders Grid + DisplayedRowsBody but no cells (GridRow's
//     memo blocks the cascade because no row prop depends on active-ness
//     — it lives on the grid container as `data-active` and reaches cells
//     via CSS). Only expansion toggle legitimately re-renders many cells,
//     and that is rare.
//
// A 100×30 flat table with `restLevelSource` and
// `serverManaged: { sort: true, filter: true, pagination: true }` performs
// zero client-side passes over data — pipeline runs `withSort` / `withFilter`
// exactly zero times. Switching that same table to `inMemoryLevelSource`
// requires changing only the host's source construction; no grid code,
// schema, or component changes.
//
// =====================================================================
// Out of scope
// =====================================================================
//
//   - Virtualization. Composes cleanly (unmounted rows don't subscribe;
//     sources aren't aware of viewport). Separate change.
//   - Realtime/streaming sources. A source that pushes updates from a
//     websocket fits the same interface — it just emits whenever the
//     server pushes. Ship as a separate impl when needed.
//   - Cross-source joins. A host can write a custom source that fans out;
//     the grid does not orchestrate.
//   - Column virtualization, frozen columns, resize. Orthogonal to the
//     data plane.
//   - Cursor-based / infinite pagination. The current pagination contract
//     is shaped for paged tables and reports. Cursor/infinite is the
//     planned extension point: add a sibling verb (e.g.
//     `setCursor(cursor, pageSize)`) and widen `pagination` to a
//     discriminated union. The invariant "the source publishes already-
//     windowed nodes" survives unchanged. Don't generalize prematurely.
//   - Domain features (FK chips, link adornments, schema-derived context
//     menus). Consumer-side: they live outside `grid/`, attach data via
//     `column.meta`, and supply `renderCell` / `editCell` / context-
//     menu contributors.
//
// =====================================================================

// Public API only below this line. Implementation modules live under
// runtime/, data-sources/, pipeline/, interaction/, schema/, and react/.

export {
  createGridRuntime,
  createTableController,
  type GridRuntime,
  type RuntimeArgs,
  type TableController,
  type ReadonlyTableController,
  type WritableTableController,
  type RootPhantomHelpers,
  type GridEmitter,
  type GridEvents,
} from "./runtime";

export {
  GridRuntimeProvider,
  useDisplayedRow,
  useDisplayedRowSequence,
  useGridRuntime,
  GridLevel,
  type GridLevelChrome,
} from "./react";

export { inMemoryGridDataSource, restGridDataSource } from "./data-sources";
export {
  createDisplayedRowsStore,
  buildDisplayedRowSequence,
  deriveDisplayedRowsState,
  reuseDisplayedRowSequenceIfUnchanged,
  type DisplayedRowsInput,
  type DisplayedRowsInvalidationReason,
  type DisplayedRowsState,
  type DisplayedRowsStore,
  type CreateDisplayedRowsStoreArgs,
  type DisplayedRowsViewState,
} from "./displayed-rows";
export type {
  GridDataSource,
  LevelDataSource,
  RuntimeLevelDataSource,
  FetchPageRequest,
  FetchPageResponse,
  InMemoryGridDataSourceOpts,
  InMemoryLevelOpts,
  RestGridDataSourceOpts,
  RestEndpointFactory,
} from "./data-sources";

export type {
  Brand,
  ColId,
  RowKey,
  GridPath,
  RowId,
  Coord,
  ColumnSchema,
  EditTrigger,
  NonTypedEditTrigger,
  CellEditorStart,
  CellRenderProps,
  CellEditorProps,
  LevelSchema,
  GridSchema,
  TreeNode,
  LevelOptions,
  LevelRow,
  LevelRowKind,
  FooterRow,
  PhantomRow,
  DisplayedRowRef,
  DisplayedRowSequence,
  DisplayedRows,
  RowCapabilities,
  SelectionState,
  CellSelectionStatus,
  EditingState,
  ControllerState,
  GridEffect,
  CursorPlacement,
  NavigationDirection,
  CommitTarget,
  StartEditAction,
  GridAction,
  ColPolicy,
  RowDirection,
  NavigationIntent,
  SortDescriptor,
} from "./types";
export {
  rootPath,
  childPath,
  parseChildPath,
  makeRowId,
  pathOfRowId,
  rowKeyOfRowId,
  coordsEqual,
  ALL_EDIT_TRIGGERS,
  triggersFor,
  triggerAllowed,
  capabilitiesFor,
  capabilitiesOf,
  firstFocusableRow,
  lastFocusableRow,
  nextFocusableRow,
  makeSelection,
  selectionFocus,
  selectionContainsCoord,
  selectionIsSingleCell,
  rowsInSelection,
} from "./types";
export {
  parseSortString,
  stringifySortOrder,
  cycleSort,
  sortOrderEqual,
} from "./sort";
