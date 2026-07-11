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
