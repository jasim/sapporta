import { createContext, memo, useContext, type ReactNode } from "react";
import type { ColId, GridPath, RowId } from "../../types/identity";
import type { RowInteractionStatus } from "../../types/row-selection";
import type { ColumnSchema, RowHeaderColumn } from "../../types/schema";
import { cardRoleOf } from "../../types/presentation";
import { capabilitiesFor } from "../../types/capabilities";
import { useDisplayedRow, useGridRuntime } from "../GridRuntimeProvider";
import type { GridPresentation } from "../Grid";
import {
  eventTargetIsWithin,
  gridRowIdentityAttrs,
} from "../internal/dom-targets";
import { GridDataCell } from "./GridDataCell";
import { EmptyRowHeaderCell } from "./RowHeaderCell";
import { runtimeInternalsFor } from "../../runtime/runtime";

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
  presentation,
  rowInteractionStatus,
  rowHeaderColumn,
}: {
  rowId: RowId;
  schema: readonly ColumnSchema[];
  path: GridPath;
  colOrder: readonly ColId[];
  presentation: GridPresentation;
  rowInteractionStatus: RowInteractionStatus;
  rowHeaderColumn: RowHeaderColumn;
}) {
  const runtime = useGridRuntime();
  const internals = runtimeInternalsFor(runtime);
  const controller = internals.controllerFor(path);
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
        // Without this check, pressing a button in a dialog opened by this row
        // moves the row cursor and returns focus to the grid.
        if (!eventTargetIsWithin(event.target, event.currentTarget)) return;
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
      onClick={(event) => {
        // Without this check, clicking inside a dialog opened by this row also
        // activates the row.
        if (!eventTargetIsWithin(event.target, event.currentTarget)) return;
        controller.handleRowPointer(row.id, {
          gesture: "click",
          button: event.button,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
      }}
      onDoubleClick={(event) => {
        // Without this check, double-clicking inside a dialog opened by this
        // row also runs the row's double-click action.
        if (!eventTargetIsWithin(event.target, event.currentTarget)) return;
        controller.handleRowPointer(row.id, {
          gesture: "doubleClick",
          button: event.button,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
      }}
    >
      <RowInteractionStatusProvider status={rowInteractionStatus}>
        {rowHeaderColumn === "empty-selectable-cell" ? (
          <EmptyRowHeaderCell
            row={row}
            path={path}
            selected={selected}
            presentation={presentation}
          />
        ) : null}
        {schema.map((col) => (
          <RowCellSlot
            key={col.id}
            column={col}
            value={row.columns[col.id]}
            presentation={presentation}
          >
            <GridDataCell
              row={row}
              column={col}
              path={path}
              colOrder={colOrder}
              presentation={presentation}
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
  value,
  presentation,
  children,
}: {
  column: ColumnSchema;
  value: unknown;
  presentation: GridPresentation;
  children: ReactNode;
}) {
  if (presentation === "tabular") return children;
  const displayType = displayTypeOf(column);
  const cardRole = cardRoleOf(column);
  // The title is the card's heading — no label.
  const labelled = cardRole !== "title";
  // Emptiness is marked only for columns that opted in via meta, because only
  // the schema author knows whether an empty stored value still renders
  // content (client columns and custom cell renderers do). The title is the
  // record's identity and never marks itself empty.
  const fieldEmpty =
    labelled &&
    cardHideWhenEmptyOf(column) &&
    (value === null || value === undefined || value === "");
  return (
    <div
      data-grid-part="row-field"
      data-col-id={column.id}
      data-col-name={column.name}
      data-display-type={displayType}
      data-card-role={cardRole}
      data-field-empty={fieldEmpty ? "true" : undefined}
    >
      {labelled ? (
        <div data-grid-part="row-field-label">{column.name}</div>
      ) : null}
      <div data-grid-part="row-field-cell">{children}</div>
    </div>
  );
}

function displayTypeOf(column: ColumnSchema): string | undefined {
  if (!isRecord(column.meta)) return undefined;
  const value = column.meta.displayType;
  return typeof value === "string" ? value : undefined;
}

function cardHideWhenEmptyOf(column: ColumnSchema): boolean {
  if (!isRecord(column.meta)) return false;
  return column.meta.cardHideWhenEmpty === true;
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
