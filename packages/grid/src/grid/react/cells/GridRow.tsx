import { createContext, memo, useContext, type ReactNode } from "react";
import type { ColId, GridPath, RowId } from "../../types/identity";
import type { RowInteractionStatus } from "../../types/row-selection";
import type { ColumnSchema, RowHeaderColumn } from "../../types/schema";
import { capabilitiesFor } from "../../types/capabilities";
import { useDisplayedRow, useGridRuntime } from "../GridRuntimeProvider";
import type { GridPresentation } from "../Grid";
import { gridRowIdentityAttrs } from "../internal/dom-targets";
import { GridDataCell } from "./GridDataCell";
import { EmptyRowHeaderCell } from "./RowHeaderCell";
import { runtimeInternalsFor } from "../../runtime/create-grid-runtime";

export type RowChromeState = {
  active: boolean;
  selected: boolean;
};

export function rowChromeStateFromInteractionStatus(
  status: RowInteractionStatus,
): RowChromeState {
  return {
    active: status === "cursor" || status === "cursor-selected",
    selected: status === "selected" || status === "cursor-selected",
  };
}

// The only `React.memo` in the grid — structurally justified, not a
// hot-path hack.
//
// The parent passes stable identity props; the row data itself arrives through
// `useDisplayedRow`. Selection, focus, and editing flips inside the row hit
// GridDataCell's store subscriptions directly — they never bubble through
// GridRow. Without this memo, a parent's structural re-render would cascade to
// all rows regardless of whether their data changed.
export const GridRow = memo(function GridRow({
  rowId,
  schema,
  path,
  colOrder,
  presentation = "tabular",
  rowInteractionStatus,
  rowHeaderColumn,
}: {
  rowId: RowId;
  schema: readonly ColumnSchema[];
  path: GridPath;
  colOrder: readonly ColId[];
  presentation?: GridPresentation;
  rowInteractionStatus: RowInteractionStatus;
  rowHeaderColumn: RowHeaderColumn;
}) {
  const runtime = useGridRuntime();
  const internals = runtimeInternalsFor(runtime);
  const row = useDisplayedRow(path, rowId);
  const { active, selected } =
    rowChromeStateFromInteractionStatus(rowInteractionStatus);

  return (
    <div
      {...gridRowIdentityAttrs(row.id)}
      data-row-kind={row.kind}
      data-row-phantom-state={
        row.kind === "phantom" ? row.source.state.kind : undefined
      }
      data-row-active={active ? "true" : undefined}
      data-row-selected={selected ? "true" : undefined}
      data-row-presentation={presentation}
      data-row-interaction-status={rowInteractionStatus}
      data-row-selectable={String(capabilitiesFor(row.kind).rowSelectable)}
      data-has-row-header={rowHeaderColumn !== "none" ? "true" : undefined}
      aria-selected={selected ? true : undefined}
      role="row"
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (runtime.interaction.mode !== "row-list") return;
        if (!row.rowSelectable) return;
        event.preventDefault();
        // In row-list mode, row click owns the row cursor. In cell-grid mode,
        // cell click owns the cell cursor instead, so this row shell stays out
        // of the cell interaction path.
        if (event.shiftKey) {
          internals.cursorManager.extendRowSelectionToCursor({
            path,
            rowId: row.id,
          });
        } else {
          internals.cursorManager.moveRowCursorTo({ path, rowId: row.id });
        }
      }}
    >
      <RowInteractionStatusProvider status={rowInteractionStatus}>
        {rowHeaderColumn === "empty-selectable-cell" ? (
          <EmptyRowHeaderCell row={row} path={path} selected={selected} />
        ) : null}
        {schema.map((col) => (
          <RowCellSlot key={col.id} column={col} presentation={presentation}>
            <GridDataCell
              row={row}
              column={col}
              path={path}
              colOrder={colOrder}
              rowHeader={
                typeof rowHeaderColumn === "object" &&
                rowHeaderColumn.column === col.id
              }
            />
          </RowCellSlot>
        ))}
      </RowInteractionStatusProvider>
    </div>
  );
});

function RowCellSlot({
  column,
  presentation,
  children,
}: {
  column: ColumnSchema;
  presentation: GridPresentation;
  children: ReactNode;
}) {
  if (presentation === "tabular") return children;
  const displayType = displayTypeOf(column);
  return (
    <div
      data-grid-part="row-field"
      data-col-id={column.id}
      data-col-name={column.name}
      data-display-type={displayType}
    >
      <div data-grid-part="row-field-label">{column.name}</div>
      <div data-grid-part="row-field-cell">{children}</div>
    </div>
  );
}

function displayTypeOf(column: ColumnSchema): string | undefined {
  if (!isRecord(column.meta)) return undefined;
  const value = column.meta.displayType;
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const CurrentRowInteractionStatusContext =
  createContext<RowInteractionStatus>("idle");

function RowInteractionStatusProvider({
  status,
  children,
}: {
  status: RowInteractionStatus;
  children: ReactNode;
}) {
  return (
    <CurrentRowInteractionStatusContext.Provider value={status}>
      {children}
    </CurrentRowInteractionStatusContext.Provider>
  );
}

export function useCurrentRowInteractionStatus(): RowInteractionStatus {
  return useContext(CurrentRowInteractionStatusContext);
}
