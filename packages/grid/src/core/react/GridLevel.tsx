import {
  Fragment,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ColId, GridPath } from "../types/identity";
import type { ColumnSchema, RowHeaderColumn } from "../types/schema";
import { Grid, type GridChromeContext, type GridPresentation } from "./Grid";
import { GridRow } from "./cells/GridRow";
import {
  useDisplayedRowSequence,
  useGridRuntime,
  useLevelSourceState,
  usePhantoms,
  useCellSelectionRectangle,
  useRowInteractionSnapshot,
} from "./GridRuntimeProvider";
import { rowInteractionStatusFor } from "../types/row-selection";
import type { LevelSourceState, SourceLoadResult } from "../data-sources";
import { runtimeInternalsFor } from "../runtime/runtime";
import type { CellSelectionRectangle } from "../types/selection";

export type GridLevelChrome = {
  renderHeader?: (ctx: GridChromeContext) => ReactNode;
  renderStatus?: (ctx: GridStatusContext) => ReactNode;
  renderEmpty?: (ctx: GridEmptyContext) => ReactNode;
  /**
   * Renders chrome derived from the current cell range, such as totals beneath
   * selected numeric columns. The callback runs only while the range resolves
   * to rows and columns that are still displayed.
   */
  renderSelectionSummary?: (ctx: GridSelectionSummaryContext) => ReactNode;
  levelContainerClassName?: (ctx: GridChromeContext) => string | undefined;
  levelContainerStyle?: (ctx: GridChromeContext) => CSSProperties | undefined;
};

export type GridStatusContext = GridChromeContext & {
  state: LevelSourceState;
  retry?: () => Promise<SourceLoadResult>;
};

export type GridEmptyContext = GridChromeContext & {
  state: Extract<LevelSourceState, { status: "ready" }>;
  phantomCount: number;
};

/**
 * The level and resolved cell range passed to `renderSelectionSummary`.
 *
 * Rows and columns follow their current display order and update as visible
 * values, drafts, or the selection change.
 */
export type GridSelectionSummaryContext = GridChromeContext & {
  selection: CellSelectionRectangle;
};

// The recursive unit — the only component that bridges the two stores.
//
// GridLevel pulls displayed/schema/controller from the runtime (static +
// transient channels) and subscribes to `coordinator.expansion` (structural
// channel) so it can interleave each row's child level mounts directly
// inside `<Grid>`'s body. Every input needed to interleave the DOM —
// display order, expansion, schema-declared child levels, and which child
// paths are materialized — is already in the renderer internals, so
// no separate cached displayed-row derivation sits between them.
//
// The renderer's materialized-child lookup returns the child paths whose source
// is registered for that parent row, in schema declaration order.
// "Materialized" is *source registered*, not *currently expanded*:
// expansion gating happens here, where it can read `coordinator.expansion`
// directly.
//
// ChildLevelMount gates the full `<GridLevel>` mount on the child source's
// status. While loading or errored, only the status band renders under the
// parent row — the heavy `<Grid>` markup stays unmounted until the source
// resolves to `ready`. This means loading chrome does NOT appear as a
// sentinel row inside `displayed.rows` — it renders as a band between the
// owning row and the next sibling row, and is invisible to the
// interaction layer (focus targets, selection ranges, copy buffers,
// boundary navigation).
export function GridLevel({
  path,
  chrome,
  presentation,
}: {
  path: GridPath;
  chrome?: GridLevelChrome;
  presentation: GridPresentation;
}) {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  const internals = runtimeInternalsFor(runtime);
  const controller = internals.controllerFor(path);
  const schema = level.schema.columns;
  const rowHeaderColumn = resolveRowHeaderColumn(
    runtime.interaction.mode,
    level.schema.rowHeaderColumn,
    presentation,
  );
  const state = useLevelSourceState(path);
  const phantoms = usePhantoms(path);
  const colOrder = useMemo(() => schema.map((c) => c.id), [schema]);
  const chromeContext: GridChromeContext = {
    path,
    levelName: level.schema.name,
    presentation,
    schema,
    rowHeaderColumn,
  };
  const retry = level.data.query?.refetch;
  // Status chrome is sampled before the body so loading/error information stays
  // outside `displayed.rows`. Empty chrome is sampled after the body guard: the
  // level is empty only when the ready source has no nodes, no footers, and the
  // phantom channel has no authoring rows.
  const status = chrome?.renderStatus?.({ ...chromeContext, state, retry });
  const empty =
    state.status === "ready" &&
    state.snapshot.nodes.length === 0 &&
    phantoms.length === 0 &&
    (state.snapshot.footerRows?.length ?? 0) === 0
      ? chrome?.renderEmpty?.({
          ...chromeContext,
          state,
          phantomCount: phantoms.length,
        })
      : null;

  return (
    <>
      {status}
      <Grid
        path={path}
        schema={schema}
        rowHeaderColumn={rowHeaderColumn}
        controller={controller}
        presentation={presentation}
        renderHeader={chrome?.renderHeader}
        levelContainerClassName={chrome?.levelContainerClassName}
        levelContainerStyle={chrome?.levelContainerStyle}
      >
        <DisplayedRowsBody
          path={path}
          schema={schema}
          rowHeaderColumn={rowHeaderColumn}
          colOrder={colOrder}
          chrome={chrome}
          presentation={presentation}
        />
        {chrome?.renderSelectionSummary ? (
          <SelectionSummaryChrome
            context={chromeContext}
            render={chrome.renderSelectionSummary}
          />
        ) : null}
      </Grid>
      {empty}
    </>
  );
}

// A data-backed row header is a spreadsheet affordance: in cards its tinted
// cell would read as a full-width selected band, so it demotes to a plain
// field. The structural checkbox gutter keeps its meaning everywhere.
function resolveRowHeaderColumn(
  interactionMode: "cell-grid" | "row-list",
  rowHeaderColumn: RowHeaderColumn,
  presentation: GridPresentation,
): RowHeaderColumn {
  if (interactionMode !== "cell-grid") return "none";
  if (presentation === "cards" && typeof rowHeaderColumn === "object") {
    return "none";
  }
  return rowHeaderColumn;
}

function DisplayedRowsBody({
  path,
  schema,
  rowHeaderColumn,
  colOrder,
  chrome,
  presentation,
}: {
  path: GridPath;
  schema: readonly ColumnSchema[];
  rowHeaderColumn: RowHeaderColumn;
  colOrder: readonly ColId[];
  chrome?: GridLevelChrome;
  presentation: GridPresentation;
}) {
  const runtime = useGridRuntime();
  const internals = runtimeInternalsFor(runtime);
  // Body mapping subscribes to row refs, not `LevelRow` objects. A cell edit
  // should re-render only the owning `GridRow`, not this mapper.
  const sequence = useDisplayedRowSequence(path);
  const rowInteraction = useRowInteractionSnapshot(path);
  const expansion = useSyncExternalStore(
    internals.coordinator.subscribe,
    () => internals.coordinator.getState().expansion.get(path),
    () => internals.coordinator.getState().expansion.get(path),
  );

  return (
    <div data-grid-part="body" role="rowgroup">
      {sequence.rows.map((rowRef) => {
        const childPaths = expansion?.has(rowRef.id)
          ? internals.materializedChildren(path, rowRef.id)
          : null;
        return (
          <Fragment key={rowRef.id}>
            <GridRow
              rowId={rowRef.id}
              schema={schema}
              rowHeaderColumn={rowHeaderColumn}
              path={path}
              colOrder={colOrder}
              presentation={presentation}
              rowInteractionStatus={rowInteractionStatusFor(
                rowRef.id,
                rowInteraction,
              )}
            />
            {childPaths?.map((cp) => (
              <ChildLevelMount
                key={cp}
                path={cp}
                chrome={chrome}
                presentation={presentation}
              />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}

function SelectionSummaryChrome({
  context,
  render,
}: {
  context: GridChromeContext;
  render: (context: GridSelectionSummaryContext) => ReactNode;
}) {
  const selection = useCellSelectionRectangle(context.path);
  return selection ? render({ ...context, selection }) : null;
}

// Per-child-row wrapper that gates the full `<GridLevel>` mount on the
// child source's status. While loading or errored, only the status slot
// renders under the parent row — the heavy `<Grid>` markup stays unmounted
// until the source resolves to `ready`. The status flip wakes this
// component (via `useLevelSourceState`) without re-rendering the parent.
//
// The wrapper is part of the layout contract. Expanded child grids are
// visually interleaved with parent rows, but they must not be direct grid
// items in the parent body. A nested grid root that spans the parent subgrid
// can feed its intrinsic width back into the parent's track sizing; the
// wrapper gives CSS a contained grid item to span instead.
function ChildLevelMount({
  path,
  chrome,
  presentation,
}: {
  path: GridPath;
  chrome?: GridLevelChrome;
  presentation: GridPresentation;
}) {
  const state = useLevelSourceState(path);
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  const schema = level.schema.columns;
  const rowHeaderColumn = resolveRowHeaderColumn(
    runtime.interaction.mode,
    level.schema.rowHeaderColumn,
    presentation,
  );
  const chromeContext: GridChromeContext = {
    path,
    levelName: level.schema.name,
    presentation,
    schema,
    rowHeaderColumn,
  };
  const retry = level.data.query?.refetch;
  return (
    <div data-grid-part="child-level">
      {state.status === "ready" ? (
        <GridLevel path={path} chrome={chrome} presentation={presentation} />
      ) : (
        chrome?.renderStatus?.({ ...chromeContext, state, retry })
      )}
    </div>
  );
}
