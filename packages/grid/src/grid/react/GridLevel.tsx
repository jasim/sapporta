import { Fragment, useMemo, type CSSProperties, type ReactNode } from "react";
import { useStore } from "zustand";
import type { ColId, GridPath } from "../types/identity";
import type { ColumnSchema } from "../types/schema";
import { EmptyLevel } from "./EmptyLevel";
import { Grid, type GridChromeContext, type GridPresentation } from "./Grid";
import { GridRow } from "./cells/GridRow";
import { LevelStatusBand } from "./LevelStatusBand";
import {
  useDisplayedRowSequence,
  useGridRuntime,
  useLevelSnapshot,
  useRowInteractionSnapshot,
} from "./GridRuntimeProvider";
import { rowInteractionStatusFor } from "../types/row-selection";

export type GridLevelChrome = {
  renderLevelHeader?: (ctx: GridChromeContext) => ReactNode;
  levelContainerClassName?: (ctx: GridChromeContext) => string | undefined;
  levelContainerStyle?: (ctx: GridChromeContext) => CSSProperties | undefined;
};

// The recursive unit — the only component that bridges the two stores.
//
// GridLevel pulls displayed/schema/controller from the runtime (static +
// transient channels) and subscribes to `coordinator.expansion` (structural
// channel) so it can interleave each row's child level mounts directly
// inside `<Grid>`'s body. Every input needed to interleave the DOM —
// display order, expansion, schema-declared child levels, and which child
// paths are materialized — is already on the runtime + coordinator, so
// no separate cached displayed-row derivation sits between them.
//
// `runtime.materializedChildren(path, rowId)` returns the child paths
// whose source is registered for that parent row, in schema declaration
// order. "Materialized" is *source registered*, not *currently expanded*:
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
  presentation = "tabular",
}: {
  path: GridPath;
  chrome?: GridLevelChrome;
  presentation?: GridPresentation;
}) {
  const runtime = useGridRuntime();
  const controller = runtime.controllerFor(path);
  const level = runtime.schemaAt(path);
  const schema = level.columns;
  const colOrder = useMemo(() => schema.map((c) => c.id), [schema]);

  return (
    <>
      <LevelStatusBand path={path} />
      <Grid
        path={path}
        schema={schema}
        controller={controller}
        presentation={presentation}
        renderLevelHeader={chrome?.renderLevelHeader}
        levelContainerClassName={chrome?.levelContainerClassName}
        levelContainerStyle={chrome?.levelContainerStyle}
      >
        <DisplayedRowsBody
          path={path}
          schema={schema}
          colOrder={colOrder}
          chrome={chrome}
          presentation={presentation}
        />
      </Grid>
      <EmptyLevel path={path} />
    </>
  );
}

function DisplayedRowsBody({
  path,
  schema,
  colOrder,
  chrome,
  presentation,
}: {
  path: GridPath;
  schema: ColumnSchema[];
  colOrder: readonly ColId[];
  chrome?: GridLevelChrome;
  presentation: GridPresentation;
}) {
  const runtime = useGridRuntime();
  // Body mapping subscribes to row refs, not `LevelRow` objects. A cell edit
  // should re-render only the owning `GridRow`, not this mapper.
  const sequence = useDisplayedRowSequence(path);
  const rowInteraction = useRowInteractionSnapshot(path);
  const expansion = useStore(runtime.coordinator, (s) => s.expansion.get(path));

  return (
    <div data-grid-part="body" role="rowgroup">
      {sequence.rows.map((rowRef) => {
        const childPaths = expansion?.has(rowRef.id)
          ? runtime.materializedChildren(path, rowRef.id)
          : null;
        return (
          <Fragment key={rowRef.id}>
            <GridRow
              rowId={rowRef.id}
              schema={schema}
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

// Per-child-row wrapper that gates the full `<GridLevel>` mount on the
// child source's status. While loading or errored, only the status band
// renders under the parent row — the heavy `<Grid>` markup stays unmounted
// until the source resolves to `ready`. The status flip wakes this
// component (via `useLevelSnapshot`) without re-rendering the parent.
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
  const snapshot = useLevelSnapshot(path);
  return (
    <div data-grid-part="child-level">
      {snapshot.status === "ready" ? (
        <GridLevel path={path} chrome={chrome} presentation={presentation} />
      ) : (
        <LevelStatusBand path={path} />
      )}
    </div>
  );
}
