import { ChevronDown, ChevronRight } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import type { GridPath, RowId } from "../../types/identity";
import type {
  CellActivation,
  CellActivationGesture,
  CellRenderActivation,
  ColumnSchema,
} from "../../types/schema";
import { CellActivationButton } from "./CellActivationButton";
import { useGridRuntime } from "../GridRuntimeProvider";

export function rowExpansionActivation(options?: {
  startsOn?: readonly CellActivationGesture[];
}): CellActivation {
  return {
    // Pointer expansion belongs to the explicit caret button rendered by
    // ExpandableCellFrame. Keeping click out of the default gestures lets the
    // rest of the cell focus, select, edit, or activate normally.
    startsOn: options?.startsOn ?? ["enter", "space"],
    describe: ({ path, row, actions }) => {
      if (!actions.rowExpansion.canToggle({ path, row })) {
        return {
          label: "Row",
          availability: { kind: "disabled" },
        };
      }

      return {
        label: actions.rowExpansion.isExpanded({ path, rowId: row.id })
          ? "Collapse row"
          : "Expand row",
        availability: { kind: "enabled" },
      };
    },
    run: ({ path, row, actions }) => {
      actions.rowExpansion.toggle({ path, rowId: row.id });
    },
  };
}

export function ExpandableCellFrame({
  activation,
  path,
  rowId,
  children,
}: {
  activation: CellRenderActivation | null;
  path: GridPath;
  rowId: RowId;
  children?: ReactNode;
}) {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  const isExpanded = useSyncExternalStore(
    level.subscribeExpansion,
    () => level.isExpanded(rowId),
    () => level.isExpanded(rowId),
  );
  const enabled = activation?.availability.kind === "enabled";
  const expansionControl = activation ? (
    <CellActivationButton activation={activation} gridPart="expand-chevron">
      {isExpanded ? (
        <ChevronDown aria-hidden="true" size={14} strokeWidth={1.75} />
      ) : (
        <ChevronRight aria-hidden="true" size={14} strokeWidth={1.75} />
      )}
    </CellActivationButton>
  ) : (
    <span data-grid-part="expand-placeholder" />
  );
  const content = <span data-grid-part="expand-content">{children}</span>;

  return (
    <span
      data-grid-part="expand-cell"
      data-expandable={enabled ? "true" : undefined}
      data-expanded={enabled ? String(isExpanded) : undefined}
    >
      {content}
      {expansionControl}
    </span>
  );
}

export type RowExpansionColumnOptions = {
  activation?: CellActivation;
};

export function withRowExpansionColumn(
  column: ColumnSchema,
  options: RowExpansionColumnOptions = {},
): ColumnSchema {
  const renderCell = column.renderCell;
  const activation = options.activation ?? rowExpansionActivation();
  // Preserve the column's edit gestures even when Enter is also an expansion
  // gesture. The focused cell decides its primary action at runtime: Enter
  // edits a writable data cell and otherwise activates expansion, while Space
  // always remains available as the explicit expansion command.
  return {
    ...column,
    activation,
    renderCell: (props) => (
      <ExpandableCellFrame
        activation={props.activation}
        path={props.path}
        rowId={props.row.id}
      >
        {renderCell(props)}
      </ExpandableCellFrame>
    ),
  };
}
