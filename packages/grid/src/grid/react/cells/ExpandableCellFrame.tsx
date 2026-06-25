import { ChevronDown, ChevronRight } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import type { GridPath, RowId } from "../../types/identity";
import type {
  CellActivation,
  CellActivationGesture,
  CellEditGesture,
  CellRenderActivation,
  ColumnSchema,
} from "../../types/schema";
import { CellActivationButton } from "./CellActivationButton";
import { useGridRuntime } from "../GridRuntimeProvider";

export function rowExpansionActivation(options?: {
  startsOn?: readonly CellActivationGesture[];
}): CellActivation {
  return {
    startsOn: options?.startsOn ?? ["enter", "space", "click"],
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
  const isExpanded = useSyncExternalStore(
    runtime.coordinator.subscribe,
    () =>
      runtime.coordinator.getState().expansion.get(path)?.has(rowId) ?? false,
    () =>
      runtime.coordinator.getState().expansion.get(path)?.has(rowId) ?? false,
  );
  const enabled = activation?.availability.kind === "enabled";

  return (
    <span
      data-grid-part="expand-cell"
      data-expandable={enabled ? "true" : undefined}
      data-expanded={enabled ? String(isExpanded) : undefined}
    >
      {activation ? (
        <CellActivationButton activation={activation}>
          {isExpanded ? (
            <ChevronDown aria-hidden="true" size={14} strokeWidth={1.75} />
          ) : (
            <ChevronRight aria-hidden="true" size={14} strokeWidth={1.75} />
          )}
        </CellActivationButton>
      ) : (
        <span data-grid-part="expand-placeholder" />
      )}
      <span data-grid-part="expand-content">{children}</span>
    </span>
  );
}

export function withRowExpansionColumn(column: ColumnSchema): ColumnSchema {
  const renderCell = column.renderCell;
  const activation = rowExpansionActivation();
  const edit = column.edit
    ? {
        ...column.edit,
        startsOn: column.edit.startsOn.filter(
          (gesture) =>
            !activationConflictsWithEdit(activation.startsOn, gesture),
        ),
      }
    : undefined;
  return {
    ...column,
    edit: edit && edit.startsOn.length > 0 ? edit : undefined,
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

function activationConflictsWithEdit(
  activationGestures: readonly CellActivationGesture[],
  editGesture: CellEditGesture,
): boolean {
  if (editGesture === "enter") return activationGestures.includes("enter");
  if (editGesture === "doubleClick") {
    return activationGestures.includes("doubleClick");
  }
  return false;
}
